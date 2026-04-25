// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from "node:fs/promises"
import path from "node:path"
import { Worker, UnrecoverableError } from "bullmq"
import { createRedis, apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { eq } from "drizzle-orm"
import { resolveAppOwner } from "@ploydok/db/queries"
import { eventBus } from "./event-bus"
import { env } from "../env"
import { workerLog as logger } from "./logger"
import { handleDeploy } from "./handlers/deploy"
import { FatalDeployError } from "./errors"
import { handleDeleteApp } from "./handlers/delete-app"
import type { DeleteAppOptions } from "./handlers/delete-app"
import { handleDomainVerify } from "./handlers/domain-verify"
import type { DomainVerifyPayload } from "./handlers/domain-verify"
import {
  runRegistryGc,
  startRegistryGcCron,
  stopRegistryGcCron,
} from "./handlers/gc-registry"
import {
  startAuditRetentionCron,
  stopAuditRetentionCron,
} from "./handlers/audit-retention"
import {
  startPurgeWebhookSecretsCron,
  stopPurgeWebhookSecretsCron,
} from "./jobs/purge-old-webhook-secrets"
import {
  startCertExpiryCheckCron,
  stopCertExpiryCheckCron,
} from "./jobs/cert-expiry-check"
import {
  startRotateDatabasesCron,
  stopRotateDatabasesCron,
} from "./jobs/rotate-databases"
import {
  startBackupDatabasesCron,
  stopBackupDatabasesCron,
} from "./jobs/backup-databases"
import {
  startOrphanContainerGcCron,
  stopOrphanContainerGcCron,
} from "./jobs/gc-orphan-containers"
import {
  startReapStuckBuildsCron,
  stopReapStuckBuildsCron,
} from "./jobs/reap-stuck-builds"
import { handleSyncProviderRepos } from "./handlers/sync-provider-repos"
import type { SyncProviderReposPayload } from "./handlers/sync-provider-repos"

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
  opts?: { signal?: AbortSignal }
): WorkerHandle {
  const connection = createRedis(env.REDIS_URL)

  const workers: Worker[] = [
    new Worker(
      "deploy",
      async (job) => {
        const attempt = job.attemptsMade + 1
        const maxAttempts = job.opts.attempts ?? 1
        logger.info(
          { jobId: job.id, name: job.name, attempt, maxAttempts },
          "deploy job started"
        )
        try {
          await handleDeploy(db, {
            id: job.id ?? "",
            payload: JSON.stringify(job.data),
            attempts: attempt,
            max_attempts: maxAttempts,
          })
        } catch (err) {
          if (err instanceof FatalDeployError) {
            logger.error(
              { jobId: job.id, err, kind: "fatal", attempt, maxAttempts },
              "deploy.failed kind=fatal — skipping retries"
            )
            throw new UnrecoverableError(err.message)
          }
          logger.warn(
            { jobId: job.id, err, kind: "transient", attempt, maxAttempts },
            "deploy.failed kind=transient — will retry"
          )
          throw err
        }
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "gc.registry",
      async (job) => {
        logger.info({ jobId: job.id }, "gc.registry job started")
        const data = (job.data ?? {}) as { appId?: string }
        const result = await runRegistryGc(
          data.appId ? { db, appFilter: data.appId } : { db }
        )
        logger.info({ jobId: job.id, ...result }, "gc.registry done")
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "cleanup.build",
      async (job) => {
        logger.info({ jobId: job.id }, "cleanup.build job started")
        const { appId, buildId } = job.data as {
          appId: string
          buildId: string
        }
        const dir = path.join(env.PLOYDOK_BUILD_DIR, appId, buildId)
        await rm(dir, { recursive: true, force: true })
        logger.info(
          { jobId: job.id, appId, buildId, dir },
          "workspace cleaned up"
        )
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "app.delete",
      async (job) => {
        logger.info({ jobId: job.id }, "app.delete job started")
        const opts = job.data as DeleteAppOptions
        // Resolve owner + name BEFORE the cascade deletes the apps row, so we
        // can still publish a user-channel SSE notification once it's gone.
        const ownerId = await resolveAppOwner(db, opts.appId)
        const [appRow] = await db
          .select({ name: apps.name })
          .from(apps)
          .where(eq(apps.id, opts.appId))
          .limit(1)
        const appName = appRow?.name ?? "App"
        try {
          const res = await handleDeleteApp(db, opts)
          logger.info({ jobId: job.id, ...res }, "app.delete done")
          if (ownerId) {
            try {
              eventBus.publish(`user:${ownerId}`, {
                type: "app.deleted",
                appId: opts.appId,
                message: `${appName} supprimée`,
                data: { steps: res.steps },
              })
            } catch (pubErr) {
              logger.warn(
                { pubErr, appId: opts.appId },
                "eventBus publish app.deleted failed (non-fatal)"
              )
            }
          }
        } catch (err) {
          if (ownerId) {
            try {
              eventBus.publish(`user:${ownerId}`, {
                type: "app.delete.failed",
                appId: opts.appId,
                message:
                  err instanceof Error ? err.message : "Suppression échouée",
              })
            } catch {
              // best-effort
            }
          }
          throw err
        }
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "domain.verify",
      async (job) => {
        logger.info({ jobId: job.id }, "domain.verify job started")
        const payload = job.data as DomainVerifyPayload
        await handleDomainVerify(db, payload)
        logger.info(
          { jobId: job.id, domainId: payload.domainId },
          "domain.verify done"
        )
      },
      { connection, concurrency: 5 }
    ),

    new Worker(
      "provider.repos.sync",
      async (job) => {
        logger.info(
          { jobId: job.id, data: job.data },
          "provider.repos.sync job started"
        )
        const payload = job.data as SyncProviderReposPayload
        await handleSyncProviderRepos(db, payload)
        logger.info({ jobId: job.id }, "provider.repos.sync done")
      },
      { connection, concurrency: 2 }
    ),
  ]

  // Attach error loggers to each worker
  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      logger.warn({ jobId: job?.id, err }, `${worker.name} job failed`)
    })
  }

  startRegistryGcCron({ gcOptions: { db } })
  startPurgeWebhookSecretsCron(db)
  startCertExpiryCheckCron(db)
  startRotateDatabasesCron(db)
  startBackupDatabasesCron(db)
  startOrphanContainerGcCron(db)
  startReapStuckBuildsCron(db)
  startAuditRetentionCron({ db })

  const abortHandler = () => stop()
  opts?.signal?.addEventListener("abort", abortHandler)

  function stop() {
    stopRegistryGcCron()
    stopPurgeWebhookSecretsCron()
    stopCertExpiryCheckCron()
    stopRotateDatabasesCron()
    stopBackupDatabasesCron()
    stopOrphanContainerGcCron()
    stopReapStuckBuildsCron()
    stopAuditRetentionCron()
    Promise.all(workers.map((w) => w.close())).catch((err) => {
      logger.error({ err }, "error closing BullMQ workers")
    })
  }

  return { stop }
}
