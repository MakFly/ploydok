// SPDX-License-Identifier: AGPL-3.0-only
//
// Env var queries — thin wrappers over Drizzle for the env vars feature.
//
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { env_vars } from "../schema"
import type { Db } from "../client"
import type { EnvVarRow } from "../schema"

export type { EnvVarRow }

export interface EnvVarInput {
  key: string
  value: string
  secret: boolean
}

// ---------------------------------------------------------------------------
// listEnvForApp
// ---------------------------------------------------------------------------

/**
 * Returns all env vars for a given app, ordered by key ascending.
 * Callers must mask `value` for secret vars before sending to the client.
 */
export async function listEnvForApp(db: Db, appId: string): Promise<EnvVarRow[]> {
  return db
    .select()
    .from(env_vars)
    .where(eq(env_vars.app_id, appId))
    .orderBy(env_vars.key)
}

// ---------------------------------------------------------------------------
// upsertEnvVars
// ---------------------------------------------------------------------------

/**
 * Replaces the entire env var set for an app (delete-then-insert in a
 * transaction). This "replace all" semantics keeps the PATCH endpoint simple
 * and avoids complex three-way merges on the server.
 *
 * Callers must ensure `vars` is already validated (UPPER_SNAKE_CASE keys, etc.).
 */
export async function upsertEnvVars(
  db: Db,
  appId: string,
  vars: EnvVarInput[],
): Promise<EnvVarRow[]> {
  const now = new Date()

  return db.transaction(async (tx) => {
    // 1. Delete all existing vars for this app.
    await tx.delete(env_vars).where(eq(env_vars.app_id, appId))

    if (vars.length === 0) return []

    // 2. Insert the new set.
    const rows = vars.map((v) => ({
      id: nanoid(),
      app_id: appId,
      key: v.key,
      value: v.value,
      secret: v.secret,
      created_at: now,
      updated_at: now,
    }))

    await tx.insert(env_vars).values(rows)

    // 3. Return the persisted rows ordered by key.
    return tx
      .select()
      .from(env_vars)
      .where(eq(env_vars.app_id, appId))
      .orderBy(env_vars.key)
  })
}

// ---------------------------------------------------------------------------
// deleteEnvVar
// ---------------------------------------------------------------------------

/**
 * Deletes a single env var by app + key.
 */
export async function deleteEnvVar(db: Db, appId: string, key: string): Promise<void> {
  await db.delete(env_vars).where(and(eq(env_vars.app_id, appId), eq(env_vars.key, key)))
}
