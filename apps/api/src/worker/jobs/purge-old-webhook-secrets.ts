// SPDX-License-Identifier: AGPL-3.0-only
import { isNull, lt, or, sql } from "drizzle-orm"
import { apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"

const log = childLogger("webhook.secret.purge")

const ONE_DAY_MS = 24 * 60 * 60 * 1000

let _timer: ReturnType<typeof setTimeout> | null = null
let _interval: ReturnType<typeof setInterval> | null = null

/**
 * Nullifies webhook_secret_old / webhook_secret_old_expires_at for rows
 * whose grace period has elapsed.
 */
export async function purgeExpiredWebhookSecrets(db: Db): Promise<{ count: number }> {
  const now = new Date()
  const result = await db
    .update(apps)
    .set({ webhook_secret_old: null, webhook_secret_old_expires_at: null })
    .where(
      or(
        // Expired
        lt(apps.webhook_secret_old_expires_at, now),
        // Belt-and-suspenders: old secret present but expiry missing (data anomaly)
        sql`(${apps.webhook_secret_old} IS NOT NULL AND ${apps.webhook_secret_old_expires_at} IS NULL)`,
      ),
    )

  // Drizzle-pg returns rowCount on update, but the type is `QueryResult` — extract safely
  const count = (result as unknown as { rowCount?: number | null })?.rowCount ?? 0
  log.info({ event: "webhook.secret.purged", count }, "purged expired old webhook secrets")
  return { count }
}

export function startPurgeWebhookSecretsCron(db: Db): void {
  stopPurgeWebhookSecretsCron()

  async function tick() {
    try {
      await purgeExpiredWebhookSecrets(db)
    } catch (err) {
      log.error({ err }, "purge cron tick error")
    }
  }

  // Align to next 03:00 UTC (offset from gc-registry at 04:00 to avoid contention)
  const now = new Date()
  const target = new Date(now)
  target.setUTCHours(3, 0, 0, 0)
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1)
  const delay = target.getTime() - now.getTime()

  log.info(
    { delayMin: Math.round(delay / 60_000) },
    "purge-old-webhook-secrets cron scheduled",
  )

  _timer = setTimeout(() => {
    void tick()
    _interval = setInterval(() => void tick(), ONE_DAY_MS)
  }, delay)
}

export function stopPurgeWebhookSecretsCron(): void {
  if (_timer !== null) {
    clearTimeout(_timer)
    _timer = null
  }
  if (_interval !== null) {
    clearInterval(_interval)
    _interval = null
  }
}
