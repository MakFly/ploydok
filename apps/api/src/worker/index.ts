// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from "node:fs/promises"
import path from "node:path"
import { Worker } from "bullmq"
import { createRedis } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { workerLog as logger } from "./logger"
import { handleDeploy } from "./handlers/deploy"
import { handleDeleteApp } from "./handlers/delete-app"
import type { DeleteAppOptions } from "./handlers/delete-app"
import { runRegistryGc, startRegistryGcCron, stopRegistryGcCron } from "./handlers/gc-registry"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Returned by `startWorker`. Call `stop()` for graceful shutdown. */
export interface WorkerHandle {
  stop(): void
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/**
 * Start BullMQ workers for all job types.
 *
 * Each queue maps 1-to-1 to a handler. Concurrency is 1 per queue so that
 * deployments remain sequential per-app (BullMQ job options can throttle
 * further if needed).
 *
 * Pass `opts.signal` to stop via AbortSignal (e.g. from a test or SIGTERM).
 */
export function startWorker(
  db: Db,
  opts?: { signal?: AbortSignal },
): WorkerHandle {
  const connection = createRedis(env.REDIS_URL)

  const workers: Worker[] = [
    new Worker(
      "deploy",
      async (job) => {
        logger.info({ jobId: job.id, name: job.name }, "deploy job started")
        await handleDeploy(db, {
          id: job.id ?? "",
          payload: JSON.stringify(job.data),
          attempts: job.attemptsMade + 1,
          max_attempts: (job.opts.attempts ?? 1),
        })
      },
      { connection, concurrency: 1 },
    ),

    new Worker(
      "gc.registry",
      async (job) => {
        logger.info({ jobId: job.id }, "gc.registry job started")
        const data = (job.data ?? {}) as { appId?: string }
        const result = await runRegistryGc(data.appId ? { db, appFilter: data.appId } : { db })
        logger.info({ jobId: job.id, ...result }, "gc.registry done")
      },
      { connection, concurrency: 1 },
    ),

    new Worker(
      "cleanup.build",
      async (job) => {
        logger.info({ jobId: job.id }, "cleanup.build job started")
        const { appId, buildId } = job.data as { appId: string; buildId: string }
        const dir = path.join(env.PLOYDOK_BUILD_DIR, appId, buildId)
        await rm(dir, { recursive: true, force: true })
        logger.info({ jobId: job.id, appId, buildId, dir }, "workspace cleaned up")
      },
      { connection, concurrency: 1 },
    ),

    new Worker(
      "app.delete",
      async (job) => {
        logger.info({ jobId: job.id }, "app.delete job started")
        const opts = job.data as DeleteAppOptions
        const res = await handleDeleteApp(db, opts)
        logger.info({ jobId: job.id, ...res }, "app.delete done")
      },
      { connection, concurrency: 1 },
    ),
  ]

  // Attach error loggers to each worker
  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      logger.warn({ jobId: job?.id, err }, `${worker.name} job failed`)
    })
  }

  startRegistryGcCron({ gcOptions: { db } })

  const abortHandler = () => stop()
  opts?.signal?.addEventListener("abort", abortHandler)

  function stop() {
    stopRegistryGcCron()
    Promise.all(workers.map((w) => w.close())).catch((err) => {
      logger.error({ err }, "error closing BullMQ workers")
    })
  }

  return { stop }
}
