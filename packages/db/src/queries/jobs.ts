// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../client';
import { job_runs, jobs } from '../schema';

type JobType = 'deploy.requested' | 'gc.registry' | 'cleanup.build' | 'app.delete.requested';
type JobStatus = 'pending' | 'running' | 'done' | 'failed';

interface EnqueueJobInput {
  type: JobType;
  payload: unknown;
  runAt?: Date;
  /**
   * Override the schema default (3). Use `1` for jobs that must fail fast
   * without retry — typically user-triggered builds, where a transient retry
   * would re-run a hefty Docker build against the same broken input.
   */
  maxAttempts?: number;
}

interface RecordJobRunInput {
  jobId: string;
  attempt: number;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
}

export async function enqueueJob(
  db: Db,
  { type, payload, runAt, maxAttempts }: EnqueueJobInput,
) {
  const id = nanoid();
  await db.insert(jobs).values({
    id,
    type,
    payload: JSON.stringify(payload),
    run_at: runAt ?? null,
    ...(maxAttempts !== undefined && { max_attempts: maxAttempts }),
  });
  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows[0]!;
}

/**
 * Atomically pick the next eligible pending job and mark it running.
 *
 * Uses a CTE with FOR UPDATE SKIP LOCKED — the standard Postgres pattern for
 * concurrent job queues. This avoids double-processing when multiple workers
 * call this concurrently.
 */
export async function pickNextJob(db: Db, { now }: { now: Date }) {
  // Use a CTE to atomically select + update with FOR UPDATE SKIP LOCKED
  const rows = await db
    .update(jobs)
    .set({
      status: 'running',
      attempts: sql`${jobs.attempts} + 1`,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(jobs.id,
          sql`(
            SELECT ${jobs.id} FROM ${jobs}
            WHERE ${jobs.status} = 'pending'
              AND (${jobs.run_at} IS NULL OR ${jobs.run_at} <= ${now})
            ORDER BY ${jobs.created_at} ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )`
        ),
      )
    )
    .returning();

  return rows[0] ?? null;
}

export async function markJobDone(db: Db, id: string) {
  await db
    .update(jobs)
    .set({ status: 'done', updated_at: new Date() })
    .where(eq(jobs.id, id));
}

export async function markJobFailed(
  db: Db,
  id: string,
  error: string,
  { retry }: { retry: boolean },
) {
  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  const job = rows[0];
  if (!job) return;

  const canRetry = retry && job.attempts < job.max_attempts;
  const nextStatus: JobStatus = canRetry ? 'pending' : 'failed';

  await db
    .update(jobs)
    .set({ status: nextStatus, error_message: error, updated_at: new Date() })
    .where(eq(jobs.id, id));
}

export async function recordJobRun(
  db: Db,
  { jobId, attempt, startedAt, finishedAt, error }: RecordJobRunInput,
) {
  await db.insert(job_runs).values({
    id: nanoid(),
    job_id: jobId,
    attempt,
    started_at: startedAt ?? null,
    finished_at: finishedAt ?? null,
    error: error ?? null,
  });
}
