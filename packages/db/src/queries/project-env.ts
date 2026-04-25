// SPDX-License-Identifier: AGPL-3.0-only
//
// Project-level env var queries — thin wrappers over Drizzle for shared env vars.
//
import { and, eq, isNotNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { project_env_vars, projects, memberships } from "../schema"
import type { Db } from "../client"
import type { ProjectEnvVarRow } from "../schema"

type ProjectRow = typeof projects.$inferSelect

export type { ProjectEnvVarRow }

export interface ProjectEnvVarInput {
  key: string
  valueEnc: Buffer
  valueNonce: Buffer
  isSecret: boolean
}

// ---------------------------------------------------------------------------
// getProjectForUser
// ---------------------------------------------------------------------------

/**
 * Returns the project row if the given user has access (any role) via membership.
 */
export async function getProjectForUser(
  db: Db,
  projectId: string,
  userId: string
): Promise<ProjectRow | null> {
  const rows = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      memberships,
      and(
        eq(memberships.org_id, projects.id),
        eq(memberships.user_id, userId),
        isNotNull(memberships.accepted_at)
      )
    )
    .where(eq(projects.id, projectId))
    .limit(1)

  return rows[0]?.project ?? null
}

export interface ProjectEnvVarDecrypted {
  key: string
  value: string
  isSecret: boolean
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// listProjectEnv
// ---------------------------------------------------------------------------

/**
 * Returns all env vars for a given project, ordered by key ascending.
 * Values remain encrypted; API layer is responsible for decryption.
 */
export async function listProjectEnv(
  db: Db,
  projectId: string
): Promise<ProjectEnvVarRow[]> {
  return db
    .select()
    .from(project_env_vars)
    .where(eq(project_env_vars.project_id, projectId))
    .orderBy(project_env_vars.key)
}

// ---------------------------------------------------------------------------
// getProjectEnv
// ---------------------------------------------------------------------------

/**
 * Returns all project env vars as a decrypted Record<string, string>.
 * Used by deploy handler to merge with app-level env vars.
 *
 * TODO for lead: integrate this into deploy handler (apps/api/src/worker/handlers/deploy.ts).
 * Pattern: fetch project env via getProjectEnv(db, projectId), then app env,
 * merge with app taking precedence on conflict. Pass decryptField from API layer.
 *
 * Signature: getProjectEnv(db, projectId, decryptField) → Record<string, string>
 * Call before constructing final env for container.
 */
export async function getProjectEnv(
  db: Db,
  projectId: string,
  decryptField: (enc: Buffer, nonce: Buffer) => Promise<string>
): Promise<Record<string, string>> {
  const rows = await listProjectEnv(db, projectId)
  const result: Record<string, string> = {}

  for (const row of rows) {
    const value = await decryptField(row.value_enc, row.value_nonce)
    result[row.key] = value
  }

  return result
}

// ---------------------------------------------------------------------------
// upsertProjectEnv
// ---------------------------------------------------------------------------

/**
 * Upserts (or creates) a single project env var.
 * Caller must provide pre-encrypted value_enc and value_nonce (from encryptField in API layer).
 */
export async function upsertProjectEnv(
  db: Db,
  projectId: string,
  input: ProjectEnvVarInput
): Promise<ProjectEnvVarRow> {
  const now = new Date()

  const result = await db
    .insert(project_env_vars)
    .values({
      id: nanoid(),
      project_id: projectId,
      key: input.key,
      value_enc: input.valueEnc,
      value_nonce: input.valueNonce,
      is_secret: input.isSecret,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [project_env_vars.project_id, project_env_vars.key],
      set: {
        value_enc: input.valueEnc,
        value_nonce: input.valueNonce,
        is_secret: input.isSecret,
        updated_at: now,
      },
    })
    .returning()

  return result[0]!
}

// ---------------------------------------------------------------------------
// deleteProjectEnv
// ---------------------------------------------------------------------------

/**
 * Deletes a project env var by project + key.
 */
export async function deleteProjectEnv(
  db: Db,
  projectId: string,
  key: string
): Promise<void> {
  await db
    .delete(project_env_vars)
    .where(
      and(
        eq(project_env_vars.project_id, projectId),
        eq(project_env_vars.key, key)
      )
    )
}
