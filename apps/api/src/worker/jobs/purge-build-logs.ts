// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import { findBuildsToPurge } from "@ploydok/db/queries"
import { childLogger } from "../../logger"
import { env } from "../../env"
import { purgeBuildLog } from "../../services/build-log-archive"

const log = childLogger("cron.logs.purge")

const TICK_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 1000

let _timer: ReturnType<typeof setInterval> | null = null

export async function purgeBuildLogs(
  db: Db
): Promise<{ purged: number; cutoff: Date }> {
  const cutoff = new Date(
    Date.now() - env.PLOYDOK_BUILD_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )
  const candidates = await findBuildsToPurge(db, cutoff, BATCH_SIZE)

  let purged = 0
  for (const row of candidates) {
    try {
      await purgeBuildLog(db, row.id, row.log_path)
      purged += 1
    } catch (err) {
      log.warn(
        { buildId: row.id, err: (err as Error).message },
        "purge: row failed (continuing)"
      )
    }
  }

  if (purged > 0 || candidates.length > 0) {
    log.info(
      {
        cutoff: cutoff.toISOString(),
        candidates: candidates.length,
        purged,
        retentionDays: env.PLOYDOK_BUILD_LOG_RETENTION_DAYS,
      },
      "build log purge tick done"
    )
  }
  return { purged, cutoff }
}

export function startPurgeBuildLogsCron(db: Db): void {
  stopPurgeBuildLogsCron()
  void purgeBuildLogs(db).catch((err) => {
    log.error({ err }, "initial purge failed")
  })
  _timer = setInterval(() => {
    void purgeBuildLogs(db).catch((err) => {
      log.error({ err }, "purge tick failed")
    })
  }, TICK_MS)
  log.info(
    {
      intervalHours: TICK_MS / (60 * 60 * 1000),
      retentionDays: env.PLOYDOK_BUILD_LOG_RETENTION_DAYS,
    },
    "purge build logs cron scheduled"
  )
}

export function stopPurgeBuildLogsCron(): void {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}
