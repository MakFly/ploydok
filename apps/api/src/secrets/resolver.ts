// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, or } from "drizzle-orm"
import { apps, env_vars, secrets } from "@ploydok/db"
import { getProjectEnv } from "@ploydok/db/queries"
import type { Db } from "@ploydok/db"
import { decryptSecret } from "./crypto"

/**
 * Read user-provided env vars from the legacy `env_vars` table.
 *
 * Historically only `secrets` fed the deploy pipeline; the `env_vars` table
 * was a UI-only surface. That asymmetry meant `PATCH /apps/:id/env` writes
 * never reached builds (silent no-op for users). We merge `env_vars` into
 * the resolver here so PATCH /env actually works end-to-end.
 *
 * Conflict policy: secrets win on key conflict, because secrets carry the
 * scope+phase semantics (build vs runtime, prod vs preview, shared vs scoped).
 * `env_vars` is treated as the lowest-precedence layer below secrets.
 */
async function fetchEnvVars(
  db: Db,
  appId: string
): Promise<Record<string, string>> {
  try {
    const rows = await db
      .select({ key: env_vars.key, value: env_vars.value })
      .from(env_vars)
      .where(eq(env_vars.app_id, appId))
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch {
    return {}
  }
}

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
  const userEnvVars = await fetchEnvVars(db, appId)
  // Precedence (low → high): app secrets < project shared < user env_vars.
  // User-provided values win — matches Coolify/Dokploy/Heroku semantics and
  // lets users override link-injected DATABASE_URL formats (e.g. SQLAlchemy
  // requires "postgresql://" / "postgresql+psycopg2://", not "postgres://").
  // Build phase: skip project shared to avoid leaking it into image layers.
  if (phase !== "runtime") return { ...appEnv, ...userEnvVars }
  const projectEnv = await fetchProjectEnv(db, appId)
  return { ...appEnv, ...projectEnv, ...userEnvVars }
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

  const [buildSecrets, runtimeApp, projectEnv, userEnvVars] = await Promise.all(
    [
      mergeScoped(buildRows),
      mergeScoped(runtimeRows),
      fetchProjectEnv(db, appId),
      fetchEnvVars(db, appId),
    ]
  )
  // Precedence (low → high): app secrets < project shared < user env_vars.
  // User-provided values win (PaaS convention).
  const build = { ...buildSecrets, ...userEnvVars }
  const runtime = { ...runtimeApp, ...projectEnv, ...userEnvVars }
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
