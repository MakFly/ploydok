// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, or } from "drizzle-orm"
import { apps, secrets } from "@ploydok/db"
import { getProjectEnv } from "@ploydok/db/queries"
import type { Db } from "@ploydok/db"
import { decryptSecret } from "./crypto"

/**
 * Fetch project-level shared env vars for the app's parent project. Merges
 * with app-level secrets downstream — app secrets win on key conflict.
 * Swallows errors : project env is a convenience layer, not critical.
 */
async function fetchProjectEnv(
  db: Db,
  appId: string
): Promise<Record<string, string>> {
  try {
    const [appRow] = await db
      .select({ projectId: apps.project_id })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1)
    if (!appRow?.projectId) return {}
    return await getProjectEnv(db, appRow.projectId, async (enc, nonce) =>
      decryptSecret(enc as Buffer, nonce as Buffer)
    )
  } catch {
    return {}
  }
}

/**
 * Build the env map to inject at runtime for a deploy.
 * Scope-specific secrets override shared secrets on key conflict.
 */
export async function buildEnvForDeploy(
  db: Db,
  appId: string,
  kind: "prod" | "preview",
  phase: "build" | "runtime" = "runtime"
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.app_id, appId),
        or(eq(secrets.scope, "shared"), eq(secrets.scope, kind)),
        or(eq(secrets.phase, phase), eq(secrets.phase, "both"))
      )
    )

  const appEnv = await mergeScoped(rows)
  // Runtime-phase only : merge project-level shared env underneath. Build
  // phase keeps app-only secrets to avoid leaking shared state into image
  // layers by accident.
  if (phase !== "runtime") return appEnv
  const projectEnv = await fetchProjectEnv(db, appId)
  return { ...projectEnv, ...appEnv }
}

/**
 * Fetch both build-phase and runtime-phase env maps in a single DB query.
 * Preferred over calling buildEnvForDeploy twice back-to-back.
 */
export async function buildEnvPairForDeploy(
  db: Db,
  appId: string,
  kind: "prod" | "preview"
): Promise<{ build: Record<string, string>; runtime: Record<string, string> }> {
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.app_id, appId),
        or(eq(secrets.scope, "shared"), eq(secrets.scope, kind))
      )
    )

  const buildRows = rows.filter(
    (r) => r.phase === "build" || r.phase === "both"
  )
  const runtimeRows = rows.filter(
    (r) => r.phase === "runtime" || r.phase === "both"
  )

  const [build, runtimeApp, projectEnv] = await Promise.all([
    mergeScoped(buildRows),
    mergeScoped(runtimeRows),
    fetchProjectEnv(db, appId),
  ])
  // Runtime inherits project-level shared env ; app secrets win on conflict.
  const runtime = { ...projectEnv, ...runtimeApp }
  return { build, runtime }
}

async function mergeScoped(
  rows: Array<{
    scope: string
    key: string
    value_ciphertext: unknown
    nonce: unknown
  }>
): Promise<Record<string, string>> {
  const shared: Record<string, string> = {}
  const scoped: Record<string, string> = {}

  await Promise.all(
    rows.map(async (row) => {
      const value = await decryptSecret(
        row.value_ciphertext as Buffer,
        row.nonce as Buffer
      )
      if (row.scope === "shared") {
        shared[row.key] = value
      } else {
        scoped[row.key] = value
      }
    })
  )

  return { ...shared, ...scoped }
}
