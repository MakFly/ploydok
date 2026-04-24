// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import type { Db } from "../client"
import { sso_configs } from "../schema"
import type { SSOConfigRow, SSOConfigInsert } from "../schema"

/**
 * Fetch SSO config for an organization.
 * Returns null if not found.
 */
export async function getSSOConfigByOrgId(
  db: Db,
  orgId: string
): Promise<SSOConfigRow | null> {
  const result = await db
    .select()
    .from(sso_configs)
    .where(eq(sso_configs.org_id, orgId))
    .limit(1)
  return result[0] ?? null
}

/**
 * Create a new SSO config for an organization.
 */
export async function createSSOConfig(
  db: Db,
  config: SSOConfigInsert
): Promise<SSOConfigRow> {
  const result = await db.insert(sso_configs).values(config).returning()
  return result[0]!
}

/**
 * Update SSO config for an organization (partial update).
 */
export async function updateSSOConfig(
  db: Db,
  orgId: string,
  updates: Partial<Omit<SSOConfigInsert, "org_id">>
): Promise<SSOConfigRow | null> {
  const result = await db
    .update(sso_configs)
    .set({
      ...updates,
      updated_at: new Date(),
    })
    .where(eq(sso_configs.org_id, orgId))
    .returning()
  return result[0] ?? null
}

/**
 * Delete SSO config for an organization.
 */
export async function deleteSSOConfig(db: Db, orgId: string): Promise<void> {
  await db.delete(sso_configs).where(eq(sso_configs.org_id, orgId))
}
