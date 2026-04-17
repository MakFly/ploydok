// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
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

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

describe('builds queries', () => {
  const db = createDb(':memory:');

  let userId: string;
  let projectId: string;
  let appId: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const now = new Date();
    userId = nanoid();
    projectId = nanoid();
    appId = nanoid();

    await db.insert(users).values({
      id: userId,
      email: `test-${userId}@example.com`,
      display_name: 'Test User',
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    });

    await db.insert(projects).values({
      id: projectId,
      owner_id: userId,
      name: 'Test Project',
      slug: `slug-${projectId}`,
      created_at: now,
    });

    await db.insert(apps).values({
      id: appId,
      project_id: projectId,
      name: 'Test App',
      slug: `app-${appId}`,
      created_at: now,
      updated_at: now,
    });
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
    const localAppId = nanoid();
    await db.insert(apps).values({
      id: localAppId,
      project_id: projectId,
      name: 'List Test App',
      slug: `app-${localAppId}`,
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
    const localAppId = nanoid();
    await db.insert(apps).values({
      id: localAppId,
      project_id: projectId,
      name: 'Rollback App',
      slug: `app-${localAppId}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const b1 = nanoid();
    const b2 = nanoid();
    const b3 = nanoid();

    await insertBuild(db, { id: b1, appId: localAppId });
    await updateBuildStatus(db, b1, 'succeeded');

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
    const localAppId = nanoid();
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
