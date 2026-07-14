// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BuildKit cache GC handler — host disk usage & reclaim (Phase 1)
 *
 * Runs `buildctl prune` via the existing cleanup-build-caches job helper.
 */
import { eq } from "drizzle-orm"
import { system_jobs } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../../logger"
import { claimQueuedRow } from "../queue-claim"
import { auditClaimed, auditUnauthorized } from "../queue-audit"
import { pruneBuildkitCache } from "../jobs/cleanup-build-caches"

const log = childLogger("gc-buildcache")

interface GcBuildCachePayload {
  id?: string
  data: unknown
}

export async function handleGcBuildcacheJob(
  db: Db,
  job: GcBuildCachePayload
): Promise<void> {
  const { jobId } = job.data as { jobId?: string }
  if (!jobId) {
    auditUnauthorized({
      jobName: "gc.buildcache.requested",
      jobId: job.id ?? "",
      payload: job.data,
      reason: "legacy payload (no jobId) — drop after queue drain",
    })
    return
  }

  const claimed = await claimQueuedRow<typeof system_jobs.$inferSelect>({
    db,
    table: system_jobs,
    id: jobId,
  })
  if (!claimed) {
    auditUnauthorized({
      jobName: "gc.buildcache.requested",
      jobId: job.id ?? "",
      payload: job.data,
      reason: "no matching pending system_jobs row",
    })
    return
  }

  auditClaimed({
    jobName: "gc.buildcache.requested",
    jobId: job.id ?? "",
    rowId: jobId,
    actor: claimed.requested_by_user_id,
    source: claimed.source,
  })

  try {
    const result = await pruneBuildkitCache()
    if (!result.ok) {
      throw new Error(
        result.error ?? `buildctl prune failed (exit ${result.exitCode})`
      )
    }
    await db
      .update(system_jobs)
      .set({
        status: "succeeded",
        finished_at: new Date(),
        result: { output: (result.output ?? "").slice(0, 10_000) },
      })
      .where(eq(system_jobs.id, jobId))
    log.info({ jobId, output: result.output }, "gc.buildcache done")
  } catch (err) {
    await db
      .update(system_jobs)
      .set({
        status: "failed",
        finished_at: new Date(),
        error_message:
          err instanceof Error ? err.message.slice(0, 1000) : String(err),
      })
      .where(eq(system_jobs.id, jobId))
    throw err
  }
}
