// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import type { Db } from "../client"
import { org_branding } from "../schema"
import type { OrgBrandingRow, OrgBrandingInsert } from "../schema"

export async function getOrgBranding(
  db: Db,
  orgId: string
): Promise<OrgBrandingRow | null> {
  const result = await db.query.org_branding.findFirst({
    where: eq(org_branding.org_id, orgId),
  })
  return result ?? null
}

export async function upsertOrgBranding(
  db: Db,
  orgId: string,
  data: Partial<Omit<OrgBrandingInsert, "org_id">>
): Promise<OrgBrandingRow> {
  const existing = await db.query.org_branding.findFirst({
    where: eq(org_branding.org_id, orgId),
  })

  if (existing) {
    const updated = await db
      .update(org_branding)
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where(eq(org_branding.org_id, orgId))
      .returning()

    return updated[0]!
  }

  const inserted = await db
    .insert(org_branding)
    .values({
      org_id: orgId,
      ...data,
    })
    .returning()

  return inserted[0]!
}

export async function deleteOrgBranding(db: Db, orgId: string): Promise<void> {
  await db.delete(org_branding).where(eq(org_branding.org_id, orgId))
}
