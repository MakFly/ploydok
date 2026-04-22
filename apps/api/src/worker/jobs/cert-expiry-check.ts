// SPDX-License-Identifier: AGPL-3.0-only
import { and, lt, isNotNull, or, isNull, sql } from "drizzle-orm"
import { tls_certificates } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"

const log = childLogger("cert.expiry.check")

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS

// Alert tiers: alert at 30d, 7d, 1d — avoid spam by tracking last_alert_sent_at
const ALERT_TIERS_DAYS = [30, 7, 1]

let _timer: ReturnType<typeof setTimeout> | null = null
let _interval: ReturnType<typeof setInterval> | null = null

export async function checkCertExpiry(db: Db): Promise<{ checked: number; alerted: number }> {
  const now = new Date()
  const threshold = new Date(now.getTime() + THIRTY_DAYS_MS)

  // Find certs expiring within 30 days that haven't been alerted recently
  const expiring = await db
    .select()
    .from(tls_certificates)
    .where(
      and(
        isNotNull(tls_certificates.not_after),
        lt(tls_certificates.not_after, threshold),
        or(
          isNull(tls_certificates.last_alert_sent_at),
          // Re-alert if last alert was > 1 day ago (prevents spam within same tier)
          lt(tls_certificates.last_alert_sent_at, new Date(now.getTime() - ONE_DAY_MS)),
        ),
      ),
    )

  let alerted = 0

  for (const cert of expiring) {
    if (!cert.not_after) continue

    const daysLeft = Math.ceil((cert.not_after.getTime() - now.getTime()) / ONE_DAY_MS)

    // Only alert at threshold tiers
    const shouldAlert = ALERT_TIERS_DAYS.some((tier) => daysLeft <= tier)
    if (!shouldAlert) continue

    try {
      log.warn(
        { appId: cert.app_id, domain: cert.domain, daysLeft, notAfter: cert.not_after },
        "tls.expiring_soon",
      )

      // Update last_alert_sent_at to avoid spam
      await db
        .update(tls_certificates)
        .set({ last_alert_sent_at: now })
        .where(sql`${tls_certificates.id} = ${cert.id}`)

      alerted++
    } catch (err) {
      log.error({ err, certId: cert.id }, "failed to process cert expiry alert")
    }
  }

  log.info({ checked: expiring.length, alerted }, "cert expiry check done")
  return { checked: expiring.length, alerted }
}

export function startCertExpiryCheckCron(db: Db): void {
  stopCertExpiryCheckCron()

  async function tick() {
    try {
      await checkCertExpiry(db)
    } catch (err) {
      log.error({ err }, "cert expiry cron tick error")
    }
  }

  // Align to next 09:00 UTC daily
  const now = new Date()
  const target = new Date(now)
  target.setUTCHours(9, 0, 0, 0)
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1)
  const delay = target.getTime() - now.getTime()

  log.info(
    { delayMin: Math.round(delay / 60_000) },
    "cert-expiry-check cron scheduled",
  )

  _timer = setTimeout(() => {
    void tick()
    _interval = setInterval(() => void tick(), ONE_DAY_MS)
  }, delay)
}

export function stopCertExpiryCheckCron(): void {
  if (_timer !== null) {
    clearTimeout(_timer)
    _timer = null
  }
  if (_interval !== null) {
    clearInterval(_interval)
    _interval = null
  }
}
