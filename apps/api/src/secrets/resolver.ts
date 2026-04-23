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

  return mergeScoped(rows)
}

/**
 * Fetch both build-phase and runtime-phase env maps in a single DB query.
 * Preferred over calling buildEnvForDeploy twice back-to-back.
 */
export async function buildEnvPairForDeploy(
  db: Db,
  appId: string,
  kind: "prod" | "preview",
): Promise<{ build: Record<string, string>; runtime: Record<string, string> }> {
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.app_id, appId),
        or(eq(secrets.scope, "shared"), eq(secrets.scope, kind)),
      ),
    )

  const buildRows = rows.filter((r) => r.phase === "build" || r.phase === "both")
  const runtimeRows = rows.filter((r) => r.phase === "runtime" || r.phase === "both")

  const [build, runtime] = await Promise.all([
    mergeScoped(buildRows),
    mergeScoped(runtimeRows),
  ])
  return { build, runtime }
}

async function mergeScoped(
  rows: Array<{
    scope: string
    key: string
    value_ciphertext: unknown
    nonce: unknown
  }>,
): Promise<Record<string, string>> {
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
