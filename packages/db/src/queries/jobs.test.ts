// SPDX-License-Identifier: AGPL-3.0-only
/**
 * jobs.test.ts — jobs queries against Postgres
 *
 * Requires PLOYDOK_TEST_PG_URL — skipped if absent.
 */
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { jobs } from '../schema';
import {
  enqueueJob,
  markJobDone,
  markJobFailed,
  pickNextJob,
  recordJobRun,
} from './jobs';

const PG_URL = Bun.env['PLOYDOK_TEST_PG_URL'];
const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

const skip = !PG_URL;
if (skip) {
  console.log('[jobs.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests');
}

describe.skipIf(skip)('jobs queries', () => {
  const db = createDb(PG_URL!);
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 });
    const migDb = drizzle(sql);
    await migrate(migDb, { migrationsFolder: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('enqueueJob creates a job with status pending', async () => {
    const job = await enqueueJob(db, {
      type: 'deploy.requested',
      payload: { appId: 'app-1' },
    });

    expect(job.id).toBeTruthy();
    expect(job.status).toBe('pending');
    expect(job.type).toBe('deploy.requested');
    expect(JSON.parse(job.payload)).toEqual({ appId: 'app-1' });

    // Cleanup
    await db.delete(jobs).where(eq(jobs.id, job.id)).catch(() => {});
  });

  it('pickNextJob returns pending job and marks it running', async () => {
    const job = await enqueueJob(db, {
      type: 'gc.registry',
      payload: { _test: 'pick-running' },
    });

    const now = new Date();
    const picked = await pickNextJob(db, { now });

    // The picked job might be any pending job — just verify one was returned
    expect(picked).not.toBeNull();
    expect(picked!.status).toBe('running');
    expect(picked!.attempts).toBeGreaterThanOrEqual(1);

    // Cleanup: mark picked as done so it doesn't pollute other tests
    await markJobDone(db, picked!.id);
    // Cleanup original if not the same
    if (picked!.id !== job.id) {
      await markJobDone(db, job.id).catch(() => {});
    }
  });

  it('markJobFailed with retry=false → status failed', async () => {
    const job = await enqueueJob(db, { type: 'gc.registry', payload: { _test: 'fail-norety' } });
    const now = new Date();
    const picked = await pickNextJob(db, { now });
    expect(picked).not.toBeNull();

    await markJobFailed(db, picked!.id, 'fatal error', { retry: false });

    // Verify it's failed now by checking the row
    const rows = await db.select().from(jobs).where(eq(jobs.id, picked!.id)).limit(1);
    expect(rows[0]?.status).toBe('failed');
  });

  it('recordJobRun inserts a run record without error', async () => {
    const job = await enqueueJob(db, { type: 'deploy.requested', payload: { _test: 'record-run' } });
    const now = new Date();
    const picked = await pickNextJob(db, { now });
    expect(picked).not.toBeNull();

    await recordJobRun(db, {
      jobId: picked!.id,
      attempt: 1,
      startedAt: now,
      finishedAt: new Date(),
    });

    await markJobDone(db, picked!.id);
    expect(true).toBe(true);
  });
});
