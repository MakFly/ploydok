// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled job: auto-rotate DB passwords whose rotation_schedule has elapsed.
 *
 * Runs hourly. Scans databases with a schedule (30d/60d/90d) and
 * password_rotated_at older than the schedule (or null).
 * Enqueues a rotation job for each eligible database.
 */
import { and, eq, isNull, lt, ne, or } from "drizzle-orm"
import { databases } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"
import { rotatePassword, RotationInProgressError } from "../../databases/rotation"

const log = childLogger("databases.rotate.cron")

const SCHEDULE_MS: Record<string, number> = {
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
}

let _interval: ReturnType<typeof setInterval> | null = null

/**
 * Scan databases and rotate passwords that are past their scheduled interval.
 */
export async function runScheduledRotations(db: Db): Promise<{ rotated: number; skipped: number }> {
  const now = Date.now()
  let rotated = 0
  let skipped = 0

  // Fetch all databases with a non-manual schedule
  const rows = await db
    .select()
    .from(databases)
    .where(
      and(
        ne(databases.rotation_schedule, "manual"),
        eq(databases.status, "running"),
        eq(databases.rotation_in_progress, false),
      ),
    )

  for (const row of rows) {
    const scheduleMs = SCHEDULE_MS[row.rotation_schedule]
    if (!scheduleMs) continue

    const lastRotated = row.password_rotated_at?.getTime() ?? 0
    const elapsed = now - lastRotated
    if (elapsed < scheduleMs) {
      skipped++
      continue
    }

    log.info(
      { databaseId: row.id, schedule: row.rotation_schedule, elapsedDays: Math.floor(elapsed / 86_400_000) },
      "triggering scheduled rotation",
    )

    try {
      await rotatePassword(db, row.id, { reason: "scheduled" })
      rotated++
    } catch (err) {
      if (err instanceof RotationInProgressError) {
        log.warn({ databaseId: row.id }, "rotation already in progress — skipped")
        skipped++
      } else {
        log.error({ databaseId: row.id, err }, "scheduled rotation failed (non-fatal, will retry)")
        skipped++
      }
    }
  }

  log.info({ rotated, skipped }, "scheduled rotation scan complete")
  return { rotated, skipped }
}

export function startRotateDatabasesCron(db: Db): void {
  stopRotateDatabasesCron()

  async function tick() {
    try {
      await runScheduledRotations(db)
    } catch (err) {
      log.error({ err }, "rotate-databases cron tick error")
    }
  }

  // Hourly cron (offset to :10 past the hour to avoid clashing with gc-registry on :00)
  const now = new Date()
  const nextRun = new Date(now)
  nextRun.setMinutes(10, 0, 0)
  if (nextRun <= now) nextRun.setHours(nextRun.getHours() + 1)
  const delay = nextRun.getTime() - now.getTime()

  log.info({ delayMin: Math.round(delay / 60_000) }, "rotate-databases cron scheduled")

  setTimeout(() => {
    void tick()
    _interval = setInterval(() => void tick(), 60 * 60 * 1000)
  }, delay)
}

export function stopRotateDatabasesCron(): void {
  if (_interval !== null) {
    clearInterval(_interval)
    _interval = null
  }
}
