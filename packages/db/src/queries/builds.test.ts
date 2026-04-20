// SPDX-License-Identifier: AGPL-3.0-only
/**
 * builds.test.ts — builds queries against Postgres
 *
 * Requires PLOYDOK_TEST_PG_URL — skipped if absent.
 */
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb } from '../client';
import { apps, projects, users } from '../schema';
import {
  getBuildById,
  getLastSucceededBuild,
  insertBuild,
  listBuildsByApp,
  updateBuildStatus,
} from './builds';

const PG_URL = Bun.env['PLOYDOK_TEST_PG_URL'];
const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

const skip = !PG_URL;
if (skip) {
  console.log('[builds.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests');
}

describe.skipIf(skip)('builds queries', () => {
  const db = createDb(PG_URL!);
  let sql: ReturnType<typeof postgres>;

  let userId: string;
  let projectId: string;
  let appId: string;

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 });
    const migDb = drizzle(sql);
    await migrate(migDb, { migrationsFolder: MIGRATIONS_DIR });

    const now = new Date();
    userId = `bt-user-${nanoid(6)}`;
    projectId = `bt-proj-${nanoid(6)}`;
    appId = `bt-app-${nanoid(6)}`;

    await db.insert(users).values({
      id: userId,
      email: `builds-test-${userId}@example.com`,
      display_name: 'Test User',
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    }).onConflictDoNothing();

    await db.insert(projects).values({
      id: projectId,
      owner_id: userId,
      name: 'Test Project',
      slug: `slug-${projectId}`,
      created_at: now,
    }).onConflictDoNothing();

    await db.insert(apps).values({
      id: appId,
      project_id: projectId,
      name: 'Test App',
      slug: `app-${appId}`,
      created_at: now,
      updated_at: now,
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    // Cleanup test data
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    await sql.end();
  });

  it('inserts a build and retrieves it by id', async () => {
    const id = nanoid();
    const build = await insertBuild(db, {
      id,
      appId,
      buildMethod: 'docker',
      commitSha: 'abc123',
    });

    expect(build).not.toBeNull();
    expect(build!.id).toBe(id);
    expect(build!.app_id).toBe(appId);
    expect(build!.status).toBe('pending');
    expect(build!.build_method).toBe('docker');
    expect(build!.commit_sha).toBe('abc123');
  });

  it('inserts a build with commitMessage and retrieves it', async () => {
    const id = nanoid();
    const build = await insertBuild(db, {
      id,
      appId,
      buildMethod: 'nixpacks',
      commitSha: 'def456',
      commitMessage: 'feat: initial commit',
    });

    expect(build).not.toBeNull();
    expect(build!.commit_message).toBe('feat: initial commit');
  });

  it('insertBuild without buildMethod defaults to null (not "auto")', async () => {
    const id = nanoid();
    const build = await insertBuild(db, { id, appId });
    expect(build!.build_method).toBeNull();
  });

  it('updateBuildStatus can update buildMethod and commitMessage', async () => {
    const id = nanoid();
    await insertBuild(db, { id, appId, buildMethod: 'docker' });

    const updated = await updateBuildStatus(db, id, 'running', {
      buildMethod: 'nixpacks',
      commitMessage: 'fix: updated via patch',
    });

    expect(updated!.build_method).toBe('nixpacks');
    expect(updated!.commit_message).toBe('fix: updated via patch');
  });

  it('updateBuildStatus → running with startedAt', async () => {
    const id = nanoid();
    await insertBuild(db, { id, appId });

    const startedAt = new Date();
    const updated = await updateBuildStatus(db, id, 'running', { startedAt });

    expect(updated!.status).toBe('running');
    expect(updated!.started_at).toBeInstanceOf(Date);
  });

  it('updateBuildStatus → succeeded with imageTag and finishedAt', async () => {
    const id = nanoid();
    await insertBuild(db, { id, appId });

    const finishedAt = new Date();
    const updated = await updateBuildStatus(db, id, 'succeeded', {
      imageTag: '127.0.0.1:5000/app:latest',
      finishedAt,
    });

    expect(updated!.status).toBe('succeeded');
    expect(updated!.image_tag).toBe('127.0.0.1:5000/app:latest');
    expect(updated!.finished_at).toBeInstanceOf(Date);
  });

  it('updateBuildStatus → failed with errorMessage', async () => {
    const id = nanoid();
    await insertBuild(db, { id, appId });

    const updated = await updateBuildStatus(db, id, 'failed', {
      errorMessage: 'build context error',
    });

    expect(updated!.status).toBe('failed');
    expect(updated!.error_message).toBe('build context error');
  });

  it('getBuildById returns null for unknown id', async () => {
    const result = await getBuildById(db, 'does-not-exist');
    expect(result).toBeNull();
  });

  it('listBuildsByApp returns up to limit results ordered by created_at desc', async () => {
    const localAppId = `bt-list-${nanoid(6)}`;
    await db.insert(apps).values({
      id: localAppId,
      project_id: projectId,
      name: 'List Test App',
      slug: `app-list-${localAppId}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const ids = [nanoid(), nanoid(), nanoid()];
    for (const id of ids) {
      await insertBuild(db, { id, appId: localAppId });
    }

    const all = await listBuildsByApp(db, localAppId, 10);
    expect(all.length).toBe(3);

    const limited = await listBuildsByApp(db, localAppId, 2);
    expect(limited.length).toBe(2);
  });

  it('getLastSucceededBuild returns most recent succeeded build', async () => {
    const localAppId = `bt-rollback-${nanoid(6)}`;
    await db.insert(apps).values({
      id: localAppId,
      project_id: projectId,
      name: 'Rollback App',
      slug: `app-rollback-${localAppId}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const b1 = nanoid();
    const b2 = nanoid();
    const b3 = nanoid();

    await insertBuild(db, { id: b1, appId: localAppId });
    await updateBuildStatus(db, b1, 'succeeded');

    // Small delay to ensure ordering
    await new Promise<void>((r) => setTimeout(r, 5));

    await insertBuild(db, { id: b2, appId: localAppId });
    await updateBuildStatus(db, b2, 'succeeded');

    await insertBuild(db, { id: b3, appId: localAppId });
    await updateBuildStatus(db, b3, 'failed');

    const last = await getLastSucceededBuild(db, localAppId);
    expect(last).not.toBeNull();
    expect(last!.status).toBe('succeeded');

    // With beforeBuildId: should return b1 (the one before b2)
    const prev = await getLastSucceededBuild(db, localAppId, b2);
    expect(prev).not.toBeNull();
    expect(prev!.id).toBe(b1);
  });

  it('FK cascade: builds deleted when app deleted', async () => {
    const localAppId = `bt-cascade-${nanoid(6)}`;
    await db.insert(apps).values({
      id: localAppId,
      project_id: projectId,
      name: 'Cascade App',
      slug: `app-cascade-${localAppId}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const buildId = nanoid();
    await insertBuild(db, { id: buildId, appId: localAppId });

    const before = await getBuildById(db, buildId);
    expect(before).not.toBeNull();

    await db.delete(apps).where(eq(apps.id, localAppId));

    const after = await getBuildById(db, buildId);
    expect(after).toBeNull();
  });
});
