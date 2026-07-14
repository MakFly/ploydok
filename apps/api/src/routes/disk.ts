// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { and, eq, inArray } from "drizzle-orm"
import { system_jobs } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import {
  DiskJobStatusSchema,
  DiskPruneResultSchema,
  DiskUsageResponseSchema,
} from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { requireInstanceAdmin } from "../auth/instance-admin"
import { getSharedAgent } from "../debug/singletons"
import { childLogger } from "../logger"
import { enqueueWithDbRow } from "../worker/queue-enqueue"
import { gcBuildCacheQueue, gcImagesQueue } from "../worker/queues"

type AppEnv = { Variables: { user?: AuthUser } }

const log = childLogger("disk.routes")

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

export function createDiskRouter(db: Db): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  const instanceAdmin = requireInstanceAdmin(db)

  // GET /disk/usage — `docker system df` breakdown + host filesystem usage.
  router.get("/usage", instanceAdmin, async (c) => {
    const agent = getSharedAgent()

    let df: Awaited<ReturnType<typeof agent.imageDf>>
    try {
      df = await agent.imageDf({})
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "AGENT_ERROR", message } }, 502)
    }

    let host: {
      totalBytes: number
      usedBytes: number
      freeBytes: number
    } | null = null
    try {
      const hs = await agent.hostStats({})
      host = {
        totalBytes: hs.diskTotalBytes,
        usedBytes: hs.diskUsedBytes,
        freeBytes: hs.diskFreeBytes,
      }
    } catch (err) {
      log.warn({ err }, "hostStats unavailable — disk.host will be null")
    }

    const payload = DiskUsageResponseSchema.parse({
      categories: df.categories.map((cat) => ({
        kind: cat.kind,
        totalBytes: cat.totalBytes,
        reclaimableBytes: cat.reclaimableBytes,
        count: cat.count,
      })),
      layersSizeBytes: df.layersSizeBytes,
      host,
    })

    return c.json(payload)
  })

  router.get("/jobs/:jobId", instanceAdmin, async (c) => {
    const rows = await db
      .select()
      .from(system_jobs)
      .where(
        and(
          eq(system_jobs.id, c.req.param("jobId")!),
          inArray(system_jobs.kind, ["gc.images", "gc.buildcache"])
        )
      )
      .limit(1)
    const job = rows[0]
    if (!job) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Disk job not found" } },
        404
      )
    }

    return c.json(
      DiskJobStatusSchema.parse({
        jobId: job.id,
        kind: job.kind,
        status: job.status,
        result: job.result ?? null,
        errorMessage: job.error_message,
        queuedAt: job.queued_at.toISOString(),
        startedAt: job.claimed_at?.toISOString() ?? null,
        finishedAt: job.finished_at?.toISOString() ?? null,
      })
    )
  })

  // POST /disk/prune/images — dangling-only image prune (all: false, safe default).
  router.post("/prune/images", instanceAdmin, async (c) => {
    const user = getUser(c)
    try {
      const { row } = await enqueueWithDbRow({
        db,
        queue: gcImagesQueue,
        jobName: "gc.images.requested",
        insertRow: (tx) =>
          tx
            .insert(system_jobs)
            .values({
              id: nanoid(),
              kind: "gc.images",
              requested_by_user_id: user.id,
              source: "api",
              options: {},
            })
            .returning()
            .then((r: (typeof system_jobs.$inferSelect)[]) => r[0]!),
        buildPayload: (row) => ({ jobId: row.id }),
      })
      return c.json(DiskPruneResultSchema.parse({ jobId: row.id }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "PRUNE_FAILED", message } }, 500)
    }
  })

  // POST /disk/prune/build-cache — buildctl prune (keep-duration/keep-storage defaults).
  router.post("/prune/build-cache", instanceAdmin, async (c) => {
    const user = getUser(c)
    try {
      const { row } = await enqueueWithDbRow({
        db,
        queue: gcBuildCacheQueue,
        jobName: "gc.buildcache.requested",
        insertRow: (tx) =>
          tx
            .insert(system_jobs)
            .values({
              id: nanoid(),
              kind: "gc.buildcache",
              requested_by_user_id: user.id,
              source: "api",
              options: {},
            })
            .returning()
            .then((r: (typeof system_jobs.$inferSelect)[]) => r[0]!),
        buildPayload: (row) => ({ jobId: row.id }),
      })
      return c.json(DiskPruneResultSchema.parse({ jobId: row.id }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "PRUNE_FAILED", message } }, 500)
    }
  })

  return router
}
