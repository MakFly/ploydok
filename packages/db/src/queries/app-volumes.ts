// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, eq } from "drizzle-orm"
import { app_volumes } from "../schema"
import type { Db } from "../client"

export type AppVolumeRow = typeof app_volumes.$inferSelect
export type AppVolumeInsert = typeof app_volumes.$inferInsert

export async function listAppVolumes(
  db: Db,
  appId: string
): Promise<AppVolumeRow[]> {
  return db
    .select()
    .from(app_volumes)
    .where(eq(app_volumes.app_id, appId))
    .orderBy(asc(app_volumes.created_at), asc(app_volumes.id))
}

export async function getAppVolume(
  db: Db,
  appId: string,
  volumeId: string
): Promise<AppVolumeRow | null> {
  const rows = await db
    .select()
    .from(app_volumes)
    .where(and(eq(app_volumes.app_id, appId), eq(app_volumes.id, volumeId)))
    .limit(1)

  return rows[0] ?? null
}

export async function insertAppVolume(
  db: Db,
  values: AppVolumeInsert
): Promise<AppVolumeRow> {
  await db.insert(app_volumes).values(values)
  return (await getAppVolume(db, values.app_id, values.id!))!
}

export async function updateAppVolume(
  db: Db,
  appId: string,
  volumeId: string,
  patch: Partial<
    Pick<AppVolumeInsert, "name" | "mount_path" | "size_limit_bytes">
  >
): Promise<AppVolumeRow | null> {
  await db
    .update(app_volumes)
    .set(patch)
    .where(and(eq(app_volumes.app_id, appId), eq(app_volumes.id, volumeId)))

  return getAppVolume(db, appId, volumeId)
}

export async function deleteAppVolume(
  db: Db,
  appId: string,
  volumeId: string
): Promise<void> {
  await db
    .delete(app_volumes)
    .where(and(eq(app_volumes.app_id, appId), eq(app_volumes.id, volumeId)))
}
