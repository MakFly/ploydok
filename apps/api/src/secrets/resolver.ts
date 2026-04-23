// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, or } from "drizzle-orm"
import { secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { decryptSecret } from "./crypto"

/**
 * Build the env map to inject at runtime for a deploy.
 * Scope-specific secrets override shared secrets on key conflict.
 */
export async function buildEnvForDeploy(
  db: Db,
  appId: string,
  kind: "prod" | "preview",
  phase: "build" | "runtime" = "runtime",
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.app_id, appId),
        or(eq(secrets.scope, "shared"), eq(secrets.scope, kind)),
        or(eq(secrets.phase, phase), eq(secrets.phase, "both")),
      ),
    )

  // Two-pass merge: shared first, then scope-specific overrides
  const shared: Record<string, string> = {}
  const scoped: Record<string, string> = {}

  await Promise.all(
    rows.map(async (row) => {
      const value = await decryptSecret(
        row.value_ciphertext as Buffer,
        row.nonce as Buffer,
      )
      if (row.scope === "shared") {
        shared[row.key] = value
      } else {
        scoped[row.key] = value
      }
    }),
  )

  return { ...shared, ...scoped }
}
