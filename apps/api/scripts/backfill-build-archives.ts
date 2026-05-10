// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-shot backfill: archive existing build logs into `builds.log_archive`
 * for rows that have a non-null log_path on disk but no archive yet.
 *
 * Usage:
 *   bun --cwd apps/api run scripts/backfill-build-archives.ts
 *   bun --cwd apps/api run scripts/backfill-build-archives.ts --dry-run
 *
 * Batches 500 rows per pass, sleeps 1s between batches to avoid Redis spike.
 * Idempotent: safe to re-run; already-archived rows are skipped.
 */
import { createDb } from "@ploydok/db"
import { findBuildsToArchive } from "@ploydok/db/queries"
import { env } from "../src/env"
import { archiveBuildLog } from "../src/services/build-log-archive"
import { childLogger } from "../src/logger"

const log = childLogger("backfill.archive")

const BATCH = 500
const SLEEP_MS = 1000
const DRY_RUN = process.argv.includes("--dry-run")

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const db = createDb(env.DATABASE_URL)
  let totalArchived = 0
  let totalSkipped = 0
  let pass = 0

  while (true) {
    pass += 1
    const candidates = await findBuildsToArchive(db, BATCH)
    if (candidates.length === 0) {
      log.info({ pass, totalArchived, totalSkipped }, "backfill: no more candidates, done")
      break
    }

    log.info(
      { pass, batch: candidates.length, dryRun: DRY_RUN },
      "backfill: processing batch"
    )

    if (DRY_RUN) {
      totalSkipped += candidates.length
      // Dry run: don't write, just count and break out (single pass).
      log.info({ wouldArchive: candidates.length }, "backfill: dry-run, exiting")
      break
    }

    for (const row of candidates) {
      try {
        const archived = await archiveBuildLog(db, row.id)
        if (archived) totalArchived += 1
        else totalSkipped += 1
      } catch (err) {
        log.warn(
          { buildId: row.id, err: (err as Error).message },
          "backfill: row failed (continuing)"
        )
        totalSkipped += 1
      }
    }

    await sleep(SLEEP_MS)
  }

  log.info(
    { totalArchived, totalSkipped, passes: pass },
    "backfill: complete"
  )
  process.exit(0)
}

main().catch((err) => {
  log.error({ err }, "backfill: fatal")
  process.exit(1)
})
