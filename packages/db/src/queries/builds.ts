// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type { Db } from '../client';
import { builds } from '../schema';

type BuildStatus = 'pending' | 'running' | 'succeeded' | 'succeeded_with_warning' | 'failed' | 'cancelled';
type BuildMethod = 'docker' | 'nixpacks';

interface InsertBuildInput {
  id: string;
  appId: string;
  buildMethod?: BuildMethod;
  commitSha?: string;
  commitMessage?: string;
}

interface UpdateBuildPatch {
  imageTag?: string;
  containerId?: string;
  startedAt?: Date;
  finishedAt?: Date;
  errorMessage?: string;
  postDeployError?: string;
  logPath?: string;
  commitSha?: string;
  commitMessage?: string;
  buildMethod?: BuildMethod;
}

export async function insertBuild(
  db: Db,
  { id, appId, buildMethod, commitSha, commitMessage }: InsertBuildInput,
) {
  await db.insert(builds).values({
    id,
    app_id: appId,
    build_method: buildMethod ?? null,
    commit_sha: commitSha ?? null,
    commit_message: commitMessage ?? null,
  });
  return getBuildById(db, id);
}

export async function updateBuildStatus(
  db: Db,
  id: string,
  status: BuildStatus,
  patch?: UpdateBuildPatch,
) {
  await db
    .update(builds)
    .set({
      status,
      ...(patch?.imageTag !== undefined && { image_tag: patch.imageTag }),
      ...(patch?.containerId !== undefined && { container_id: patch.containerId }),
      ...(patch?.startedAt !== undefined && { started_at: patch.startedAt }),
      ...(patch?.finishedAt !== undefined && { finished_at: patch.finishedAt }),
      ...(patch?.errorMessage !== undefined && { error_message: patch.errorMessage }),
      ...(patch?.postDeployError !== undefined && { post_deploy_error: patch.postDeployError }),
      ...(patch?.logPath !== undefined && { log_path: patch.logPath }),
      ...(patch?.commitSha !== undefined && { commit_sha: patch.commitSha }),
      ...(patch?.commitMessage !== undefined && { commit_message: patch.commitMessage }),
      ...(patch?.buildMethod !== undefined && { build_method: patch.buildMethod }),
    })
    .where(eq(builds.id, id));
  return getBuildById(db, id);
}

export async function getBuildById(db: Db, id: string) {
  const rows = await db.select().from(builds).where(eq(builds.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listBuildsByApp(db: Db, appId: string, limit = 10) {
  return db
    .select()
    .from(builds)
    .where(eq(builds.app_id, appId))
    .orderBy(desc(builds.created_at))
    .limit(limit);
}

export async function getLastSucceededBuild(
  db: Db,
  appId: string,
  beforeBuildId?: string,
) {
  // If beforeBuildId is given we need the created_at of that build first
  const succeededStatuses = ['succeeded', 'succeeded_with_warning'] as const;

  if (beforeBuildId) {
    const ref = await getBuildById(db, beforeBuildId);
    if (!ref) return null;
    // Use (created_at < ref OR (created_at == ref AND id != beforeBuildId))
    // Simplified: exclude the ref itself and any build created strictly after it.
    // Since builds may share the same millisecond, we exclude by id and use lte.
    const rows = await db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.app_id, appId),
          inArray(builds.status, succeededStatuses),
          ne(builds.id, beforeBuildId),
          lt(builds.created_at, ref.created_at as Date),
        ),
      )
      .orderBy(desc(builds.created_at))
      .limit(1);

    if (rows[0]) return rows[0];

    // Fallback: same-millisecond builds — find succeeded builds excluding this one
    const sameMs = await db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.app_id, appId),
          inArray(builds.status, succeededStatuses),
          ne(builds.id, beforeBuildId),
        ),
      )
      .orderBy(desc(builds.created_at))
      .limit(1);
    return sameMs[0] ?? null;
  }

  const rows = await db
    .select()
    .from(builds)
    .where(and(eq(builds.app_id, appId), inArray(builds.status, succeededStatuses)))
    .orderBy(desc(builds.created_at))
    .limit(1);
  return rows[0] ?? null;
}
