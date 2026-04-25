// SPDX-License-Identifier: AGPL-3.0-only
//
// Audit log retention (Sprint 6.5-ter / 6.1 partial).
// Purge les entrées audit_log au-delà de N jours (default 30j).
//
// Cron : tick à 03:30 UTC chaque jour. Aligné juste avant gc-registry (04:00).
// Variable d'env : PLOYDOK_AUDIT_RETENTION_DAYS (default 30).

import { lt } from "drizzle-orm"
import { audit_log } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"

const log = childLogger("audit-retention")

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_HOUR_UTC = 3
const DEFAULT_MINUTE_UTC = 30
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MAX_RETENTION_DAYS = 3650

export interface PurgeResult {
  deleted: number
  cutoff: Date
  retentionDays: number
  skipped?: boolean
}

export async function purgeOldAuditEntries(
  db: Db,
  retentionDays?: number
): Promise<PurgeResult> {
  let days: number
  if (retentionDays !== undefined) {
    days = retentionDays
  } else {
    const envValue = Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
    if (envValue !== undefined) {
      const parsed = Number(envValue)
      if (Number.isFinite(parsed) && parsed >= 1) {
        days = parsed
      } else {
        log.warn({ value: envValue }, "audit_retention.invalid_env_value")
        days = DEFAULT_RETENTION_DAYS
      }
    } else {
      days = DEFAULT_RETENTION_DAYS
    }
  }

  days = Math.max(1, Math.min(MAX_RETENTION_DAYS, days))

  if (days < 1) {
    return { deleted: 0, cutoff: new Date(0), retentionDays: 0, skipped: true }
  }

  const cutoff = new Date(Date.now() - days * ONE_DAY_MS)
  const rows = await db
    .delete(audit_log)
    .where(lt(audit_log.created_at, cutoff))
    .returning({ id: audit_log.id })

  return { deleted: rows.length, cutoff, retentionDays: days }
}

let _cronTimer: ReturnType<typeof setTimeout> | null = null
let _cronInterval: ReturnType<typeof setInterval> | null = null

function msUntilNextUtc(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
      0
    )
  )
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

export interface StartAuditRetentionCronOptions {
  db: Db
  /** Override interval ms pour tests. Default 24h. */
  intervalMs?: number
  /** Heure UTC du tick aligné. Default 3 (03:30 UTC). */
  hourUtc?: number
  /** Minute UTC. Default 30. */
  minuteUtc?: number
}

export function startAuditRetentionCron(
  opts: StartAuditRetentionCronOptions
): void {
  stopAuditRetentionCron()

  const {
    db,
    intervalMs = ONE_DAY_MS,
    hourUtc = DEFAULT_HOUR_UTC,
    minuteUtc = DEFAULT_MINUTE_UTC,
  } = opts

  async function tick(): Promise<void> {
    try {
      const result = await purgeOldAuditEntries(db)
      log.info(result, "audit_retention.tick")
    } catch (err) {
      log.error({ err: (err as Error).message }, "audit_retention.tick_failed")
    }
  }

  const delay = msUntilNextUtc(hourUtc, minuteUtc)
  log.info(
    { firstRunInMin: Math.round(delay / 60_000), hourUtc, minuteUtc },
    "audit_retention.cron_scheduled"
  )

  _cronTimer = setTimeout(() => {
    void tick()
    _cronInterval = setInterval(() => void tick(), intervalMs)
  }, delay)
}

export function stopAuditRetentionCron(): void {
  if (_cronTimer !== null) {
    clearTimeout(_cronTimer)
    _cronTimer = null
  }
  if (_cronInterval !== null) {
    clearInterval(_cronInterval)
    _cronInterval = null
  }
}
