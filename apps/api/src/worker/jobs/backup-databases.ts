// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled cron: run database and app-volume backups according to schedule_cron.
 *
 * Runs every hour at :20 past (offset to avoid clashing with other crons).
 * Uses a simple cron-expression parser to check whether a config is "due".
 * When due, calls runBackupOnce() and dispatches backup.succeeded / backup.failed.
 */
import { and, eq } from "drizzle-orm"
import { apps, databases, backup_configs, volume_backup_configs } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"
import { runBackupOnce } from "../../databases/backup"
import { runVolumeBackupOnce } from "../../backups/volume"
import { dispatch } from "../../notify/index"
import { createRedis } from "@ploydok/db"
import { env } from "../../env"

const log = childLogger("backup.cron")

let _interval: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// Cron expression checker — supports only "0 H * * *" daily schedules
// and a minimal subset needed for the default "0 3 * * *" pattern.
// ---------------------------------------------------------------------------

/**
 * Returns true if the cron expression `expr` is due at `now`.
 * Only the minute and hour fields are inspected; DOM/month/DOW must be "*".
 * This covers the default "0 3 * * *" and any daily "M H * * *" schedule.
 */
function isCronDue(expr: string, now: Date): boolean {
  try {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return false
    const [minPart, hourPart, dom, month, dow] = parts as [string, string, string, string, string]
    if (dom !== "*" || month !== "*" || dow !== "*") return false

    const nowMin = now.getUTCMinutes()
    const nowHour = now.getUTCHours()

    const matchMin = minPart === "*" || parseInt(minPart, 10) === nowMin
    const matchHour = hourPart === "*" || parseInt(hourPart, 10) === nowHour

    return matchMin && matchHour
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

export async function runScheduledBackups(db: Db): Promise<{ queued: number; skipped: number }> {
  const now = new Date()
  let queued = 0
  let skipped = 0

  const configs = await db
    .select({ config: backup_configs, db: databases })
    .from(backup_configs)
    .innerJoin(databases, eq(backup_configs.database_id, databases.id))
    .where(
      and(
        eq(backup_configs.enabled, true),
        eq(databases.status, "running"),
      ),
    )

  for (const { config, db: dbRow } of configs) {
    if (!isCronDue(config.schedule_cron, now)) {
      skipped++
      continue
    }

    log.info({ configId: config.id, databaseId: dbRow.id, cron: config.schedule_cron }, "backup due — running")
    queued++

    // Run asynchronously to not block the cron tick
    void runBackupJob(db, dbRow.id, dbRow.project_id)
  }

  const volumeConfigs = await db
    .select({ config: volume_backup_configs, app: apps })
    .from(volume_backup_configs)
    .innerJoin(apps, eq(volume_backup_configs.app_id, apps.id))
    .where(eq(volume_backup_configs.enabled, true))

  for (const { config, app } of volumeConfigs) {
    if (!isCronDue(config.schedule_cron, now)) {
      skipped++
      continue
    }

    log.info(
      { configId: config.id, appId: app.id, volumeId: config.volume_id, cron: config.schedule_cron },
      "volume backup due — running"
    )
    queued++

    void runVolumeBackupJob(db, app.id, app.name, config.volume_id, app.project_id)
  }

  return { queued, skipped }
}

// ---------------------------------------------------------------------------
// Individual job runner
// ---------------------------------------------------------------------------

async function runBackupJob(db: Db, databaseId: string, projectId: string): Promise<void> {
  try {
    const result = await runBackupOnce(db, databaseId)

    const redis = createRedis(env.REDIS_URL)
    await dispatch(
      db,
      redis,
      result.status === "succeeded" ? "backup.succeeded" : "backup.failed",
      {
        appId: databaseId,
        appName: databaseId,
        commitSha: result.backupId,
      },
      { userId: projectId, projectId },
    ).catch((err) => log.warn({ err }, "backup notification dispatch failed (non-fatal)"))
  } catch (err) {
    log.error({ err, databaseId }, "backup job crashed")

    const redis = createRedis(env.REDIS_URL)
    await dispatch(
      db,
      redis,
      "backup.failed",
      { appId: databaseId, appName: databaseId },
      { userId: projectId, projectId },
    ).catch((e) => log.warn({ e }, "backup.failed dispatch crashed (non-fatal)"))
  }
}

async function runVolumeBackupJob(
  db: Db,
  appId: string,
  appName: string,
  volumeId: string,
  projectId: string
): Promise<void> {
  try {
    const result = await runVolumeBackupOnce(db, appId, volumeId)

    const redis = createRedis(env.REDIS_URL)
    await dispatch(
      db,
      redis,
      result.status === "succeeded" ? "backup.succeeded" : "backup.failed",
      {
        appId,
        appName: `${appName}:${volumeId}`,
        commitSha: result.backupId,
      },
      { userId: projectId, projectId },
    ).catch((err) =>
      log.warn({ err, appId, volumeId }, "volume backup notification dispatch failed (non-fatal)")
    )
  } catch (err) {
    log.error({ err, appId, volumeId }, "volume backup job crashed")

    const redis = createRedis(env.REDIS_URL)
    await dispatch(
      db,
      redis,
      "backup.failed",
      { appId, appName: `${appName}:${volumeId}` },
      { userId: projectId, projectId },
    ).catch((e) =>
      log.warn({ e, appId, volumeId }, "volume backup.failed dispatch crashed (non-fatal)")
    )
  }
}

// ---------------------------------------------------------------------------
// Cron lifecycle
// ---------------------------------------------------------------------------

export function startBackupDatabasesCron(db: Db): void {
  stopBackupDatabasesCron()

  async function tick() {
    try {
      const result = await runScheduledBackups(db)
      if (result.queued > 0) {
        log.info(result, "backup-databases cron tick")
      }
    } catch (err) {
      log.error({ err }, "backup-databases cron tick error")
    }
  }

  // Align to :20 past every hour UTC to avoid clashing with other crons
  const now = new Date()
  const next = new Date(now)
  next.setUTCMinutes(20, 0, 0)
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1)
  const delay = next.getTime() - now.getTime()

  log.info({ delayMin: Math.round(delay / 60_000) }, "backup-databases cron scheduled")

  setTimeout(() => {
    void tick()
    _interval = setInterval(() => void tick(), 60 * 60 * 1000)
  }, delay)
}

export function stopBackupDatabasesCron(): void {
  if (_interval !== null) {
    clearInterval(_interval)
    _interval = null
  }
}
