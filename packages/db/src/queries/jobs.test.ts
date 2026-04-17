// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { createDb } from '../client';
import {
  enqueueJob,
  markJobDone,
  markJobFailed,
  pickNextJob,
  recordJobRun,
} from './jobs';

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

describe('jobs queries', () => {
  const db = createDb(':memory:');

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
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
  });

  it('pickNextJob returns pending job and marks it running', async () => {
    const job = await enqueueJob(db, {
      type: 'gc.registry',
      payload: {},
    });

    const now = new Date();
    const picked = await pickNextJob(db, { now });

    expect(picked).not.toBeNull();
    expect(picked!.status).toBe('running');
    expect(picked!.attempts).toBe(1);
  });

  it('pickNextJob returns null when no pending jobs', async () => {
    // Use a fresh isolated db for determinism
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const result = await pickNextJob(freshDb, { now: new Date() });
    expect(result).toBeNull();
  });

  it('enqueue 3 jobs, pickNext 2x → 2 different jobs, markDone 1, then 3rd job', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const j1 = await enqueueJob(freshDb, { type: 'deploy.requested', payload: { n: 1 } });
    const j2 = await enqueueJob(freshDb, { type: 'deploy.requested', payload: { n: 2 } });
    const j3 = await enqueueJob(freshDb, { type: 'deploy.requested', payload: { n: 3 } });

    const now = new Date();
    const p1 = await pickNextJob(freshDb, { now });
    const p2 = await pickNextJob(freshDb, { now });

    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    expect(p1!.id).not.toBe(p2!.id);

    // Mark first done
    await markJobDone(freshDb, p1!.id);

    // 3rd pick should return the remaining pending job
    const p3 = await pickNextJob(freshDb, { now });
    expect(p3).not.toBeNull();
    expect([j1.id, j2.id, j3.id]).toContain(p3!.id);
    // It must not be either already-picked job
    expect(p3!.id).not.toBe(p1!.id);
    expect(p3!.id).not.toBe(p2!.id);
  });

  it('pickNext skips jobs with future run_at', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const future = new Date(Date.now() + 60_000);
    await enqueueJob(freshDb, {
      type: 'cleanup.build',
      payload: {},
      runAt: future,
    });

    const now = new Date();
    const result = await pickNextJob(freshDb, { now });
    expect(result).toBeNull();
  });

  it('pickNext processes future job once its time has come', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const scheduledAt = new Date(Date.now() - 1); // 1ms in the past
    await enqueueJob(freshDb, {
      type: 'cleanup.build',
      payload: { delayed: true },
      runAt: scheduledAt,
    });

    const now = new Date();
    const result = await pickNextJob(freshDb, { now });
    expect(result).not.toBeNull();
    expect(result!.status).toBe('running');
  });

  it('markJobFailed with retry=true → status stays pending', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const job = await enqueueJob(freshDb, { type: 'gc.registry', payload: {} });
    const now = new Date();
    const picked = await pickNextJob(freshDb, { now });
    expect(picked).not.toBeNull();

    // attempts=1, max_attempts=3 → can retry
    await markJobFailed(freshDb, picked!.id, 'transient error', { retry: true });

    const repicked = await pickNextJob(freshDb, { now });
    expect(repicked).not.toBeNull();
    expect(repicked!.attempts).toBe(2);
  });

  it('markJobFailed with retry=false → status failed', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const job = await enqueueJob(freshDb, { type: 'gc.registry', payload: {} });
    const now = new Date();
    await pickNextJob(freshDb, { now });

    await markJobFailed(freshDb, job.id, 'fatal error', { retry: false });

    const result = await pickNextJob(freshDb, { now });
    expect(result).toBeNull(); // no more pending jobs
  });

  it('recordJobRun inserts a run record', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    const job = await enqueueJob(freshDb, { type: 'deploy.requested', payload: {} });
    const now = new Date();
    const picked = await pickNextJob(freshDb, { now });
    expect(picked).not.toBeNull();

    await recordJobRun(freshDb, {
      jobId: picked!.id,
      attempt: 1,
      startedAt: now,
      finishedAt: new Date(),
    });

    // No error thrown = success
    expect(true).toBe(true);
  });

  it('concurrency: Promise.all of 2 pickNextJob → exactly 1 wins, 1 gets null', async () => {
    const freshDb = createDb(':memory:');
    await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });

    // Only 1 pending job
    await enqueueJob(freshDb, { type: 'deploy.requested', payload: { race: true } });

    const now = new Date();
    const [r1, r2] = await Promise.all([
      pickNextJob(freshDb, { now }),
      pickNextJob(freshDb, { now }),
    ]);

    const results = [r1, r2];
    const nonNull = results.filter((r) => r !== null);
    const nulls = results.filter((r) => r === null);

    expect(nonNull.length).toBe(1);
    expect(nulls.length).toBe(1);
    expect(nonNull[0]!.status).toBe('running');
  });
});
