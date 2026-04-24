// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import type { Db } from "../client"
import { instance_license } from "../schema"
import type { InstanceLicenseRow, InstanceLicenseInsert } from "../schema"

const DEFAULT_ID = "default"

/**
 * Fetch the active instance license, if any.
 */
export async function getActiveLicense(
  db: Db
): Promise<InstanceLicenseRow | null> {
  const result = await db.query.instance_license.findFirst({
    where: eq(instance_license.id, DEFAULT_ID),
  })
  return result ?? null
}

/**
 * Activate (upsert) an instance license.
 */
export async function activateLicense(
  db: Db,
  data: Omit<InstanceLicenseInsert, "id">
): Promise<InstanceLicenseRow> {
  const existing = await db.query.instance_license.findFirst({
    where: eq(instance_license.id, DEFAULT_ID),
  })

  if (existing) {
    const updated = await db
      .update(instance_license)
      .set({
        license_id: data.license_id,
        plan: data.plan,
        seats: data.seats,
        expires_at: data.expires_at,
        activated_at: new Date(),
        activated_by: data.activated_by,
        jwt: data.jwt,
      })
      .where(eq(instance_license.id, DEFAULT_ID))
      .returning()

    return updated[0]!
  }

  const inserted = await db
    .insert(instance_license)
    .values({
      id: DEFAULT_ID,
      license_id: data.license_id,
      plan: data.plan,
      seats: data.seats,
      expires_at: data.expires_at,
      activated_at: new Date(),
      activated_by: data.activated_by,
      jwt: data.jwt,
    })
    .returning()

  return inserted[0]!
}
