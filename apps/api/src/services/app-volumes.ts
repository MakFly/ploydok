// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import type { AppVolumeRow, Db } from "@ploydok/db"
import { listAppVolumes } from "@ploydok/db/queries"

export const APP_VOLUMES_ROOT = "/var/lib/ploydok/app-volumes"

export interface RuntimeAppVolumeMount {
  id: string
  name: string
  mountPath: string
  hostPath: string
  sizeLimitBytes: number | null
  readOnly: boolean
}

export function appVolumesRootForApp(appId: string): string {
  return path.join(APP_VOLUMES_ROOT, appId)
}

export function appVolumeHostPath(appId: string, volumeId: string): string {
  return path.join(appVolumesRootForApp(appId), volumeId)
}

export function serializeAppVolume(row: AppVolumeRow) {
  return {
    id: row.id,
    name: row.name,
    mountPath: row.mount_path,
    hostPath: appVolumeHostPath(row.app_id, row.id),
    sizeLimitBytes: row.size_limit_bytes ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  }
}

export async function listRuntimeAppVolumeMounts(
  db: Db,
  appId: string,
  opts: { ensureDirectories?: boolean } = {}
): Promise<RuntimeAppVolumeMount[]> {
  const rows = await listAppVolumes(db, appId)
  const mounts = rows.map((row) => ({
    id: row.id,
    name: row.name,
    mountPath: row.mount_path,
    hostPath: appVolumeHostPath(appId, row.id),
    sizeLimitBytes: row.size_limit_bytes ?? null,
    readOnly: false,
  }))

  if (opts.ensureDirectories && mounts.length > 0) {
    await Promise.all(
      mounts.map((mount) =>
        mkdir(mount.hostPath, { recursive: true })
      )
    )
  }

  return mounts
}

export async function purgeAppVolumeHostPath(
  appId: string,
  volumeId: string
): Promise<void> {
  await rm(appVolumeHostPath(appId, volumeId), {
    recursive: true,
    force: true,
  })
}

export async function purgeAppVolumeRoot(appId: string): Promise<void> {
  await rm(appVolumesRootForApp(appId), {
    recursive: true,
    force: true,
  })
}
