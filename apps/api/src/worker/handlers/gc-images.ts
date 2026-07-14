// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Image GC handler — host disk usage & reclaim (Phase 1)
 *
 * Prunes dangling (untagged) images via the agent's ImagePrune RPC. Always
 * runs with `all: false` — the safe, dangling-only default. Exposing a
 * "prune everything unused" mode is out of scope for this handler.
 */
import { eq } from "drizzle-orm"
import { system_jobs } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getSharedAgent } from "../../debug/singletons"
import { childLogger } from "../../logger"
import { claimQueuedRow } from "../queue-claim"
import { auditClaimed, auditUnauthorized } from "../queue-audit"

const log = childLogger("gc-images")

interface GcImagesPayload {
  id?: string
  data: unknown
}

export async function handleGcImagesJob(
  db: Db,
  job: GcImagesPayload
): Promise<void> {
  const { jobId } = job.data as { jobId?: string }
  if (!jobId) {
    auditUnauthorized({
      jobName: "gc.images.requested",
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
      jobName: "gc.images.requested",
      jobId: job.id ?? "",
      payload: job.data,
      reason: "no matching pending system_jobs row",
    })
    return
  }

  auditClaimed({
    jobName: "gc.images.requested",
    jobId: job.id ?? "",
    rowId: jobId,
    actor: claimed.requested_by_user_id,
    source: claimed.source,
  })

  try {
    const agent = getSharedAgent()
    const result = await agent.imagePrune({
      all: false,
      untilUnix: 0,
      keepRepoTags: [],
    })
    await db
      .update(system_jobs)
      .set({
        status: "succeeded",
        finished_at: new Date(),
        result: {
          imagesDeleted: result.imagesDeleted,
          spaceReclaimedBytes: result.spaceReclaimedBytes,
        },
      })
      .where(eq(system_jobs.id, jobId))
    log.info(
      {
        jobId,
        imagesDeleted: result.imagesDeleted,
        spaceReclaimedBytes: result.spaceReclaimedBytes,
      },
      "gc.images done"
    )
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
