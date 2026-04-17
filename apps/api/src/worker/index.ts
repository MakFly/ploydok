// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  pickNextJob,
  markJobDone,
  markJobFailed,
  recordJobRun,
  enqueueJob,
} from "@ploydok/db/queries";
import type { Db } from "@ploydok/db";
import { env } from "../env";
import { workerLog as logger } from "./logger";
import { handleDeploy } from "./handlers/deploy";
import { runRegistryGc, startRegistryGcCron, stopRegistryGcCron } from "./handlers/gc-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Returned by `startWorker`. Call `stop()` for graceful shutdown. */
export interface WorkerHandle {
  stop(): void;
}

type JobRow = Awaited<ReturnType<typeof pickNextJob>>;
type Job = NonNullable<JobRow>;

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

/**
 * Start the background polling worker.
 *
 * The worker polls the `jobs` table every `intervalMs` milliseconds,
 * picks the next eligible pending job, and dispatches it.
 *
 * Pass `opts.signal` to stop via AbortSignal (e.g. from a test or SIGTERM).
 */
export function startWorker(
  db: Db,
  opts?: { intervalMs?: number; signal?: AbortSignal },
): WorkerHandle {
  const interval = opts?.intervalMs ?? 2_000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const job = await pickNextJob(db, { now: new Date() });
      if (job) await dispatch(db, job);
    } catch (err) {
      logger.error({ err }, "worker.tick.error");
    }
  };

  const timer = setInterval(tick, interval);

  startRegistryGcCron({ gcOptions: { db } });

  opts?.signal?.addEventListener("abort", () => {
    stopped = true;
    clearInterval(timer);
    stopRegistryGcCron();
  });

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      stopRegistryGcCron();
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(db: Db, job: Job): Promise<void> {
  const startedAt = new Date();

  logger.info({ jobId: job.id, type: job.type, attempt: job.attempts }, "job dispatched");

  try {
    switch (job.type) {
      case "deploy.requested":
        await handleDeploy(db, job);
        break;

      case "gc.registry": {
        const payload = job.payload ? JSON.parse(job.payload) as { appId?: string } : {};
        const result = await runRegistryGc(
          payload.appId ? { db, appFilter: payload.appId } : { db },
        );
        logger.info({ jobId: job.id, ...result }, "gc.registry done");
        break;
      }

      case "cleanup.build":
        await cleanupBuild(db, job);
        break;

      default: {
        const unknownType = (job as { type: string }).type;
        await markJobFailed(db, job.id, `unknown job type: ${unknownType}`, { retry: false });
        await recordJobRun(db, {
          jobId: job.id,
          attempt: job.attempts,
          startedAt,
          finishedAt: new Date(),
          error: `unknown job type: ${unknownType}`,
        });
        return;
      }
    }

    await markJobDone(db, job.id);
    await recordJobRun(db, {
      jobId: job.id,
      attempt: job.attempts,
      startedAt,
      finishedAt: new Date(),
    });

    logger.info({ jobId: job.id, type: job.type }, "job done");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const canRetry = job.attempts < job.max_attempts;

    logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, retry: canRetry, err }, "job failed");

    await markJobFailed(db, job.id, msg, { retry: canRetry });
    await recordJobRun(db, {
      jobId: job.id,
      attempt: job.attempts,
      startedAt,
      finishedAt: new Date(),
      error: msg,
    });
  }
}

// ---------------------------------------------------------------------------
// Built-in handlers
// ---------------------------------------------------------------------------

async function cleanupBuild(db: Db, job: Job): Promise<void> {
  const { appId, buildId } = JSON.parse(job.payload) as { appId: string; buildId: string };
  const dir = path.join(env.PLOYDOK_BUILD_DIR, appId, buildId);
  await rm(dir, { recursive: true, force: true });
  logger.info({ jobId: job.id, appId, buildId, dir }, "workspace cleaned up");
}
