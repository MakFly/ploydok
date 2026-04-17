// SPDX-License-Identifier: AGPL-3.0-only
//
// App CRUD queries — thin wrappers over Drizzle to keep routes clean.
//
import { and, desc, eq } from "drizzle-orm";
import { apps, builds, projects } from "@ploydok/db";
import type { Db } from "@ploydok/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppRow = typeof apps.$inferSelect;
export type BuildRow = typeof builds.$inferSelect;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns the app row if the given user owns the project it belongs to.
 * Used to verify ownership before any mutation.
 */
export async function getAppForUser(
  db: Db,
  appId: string,
  userId: string,
): Promise<AppRow | null> {
  const rows = await db
    .select({ app: apps })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(and(eq(apps.id, appId), eq(projects.owner_id, userId)))
    .limit(1);

  return rows[0]?.app ?? null;
}

/**
 * Returns all apps belonging to projects owned by `userId`.
 */
export async function listAppsForUser(
  db: Db,
  userId: string,
): Promise<{
  id: string;
  project_id: string;
  name: string;
  slug: string;
  status: string | null;
  git_provider: string | null;
  repo_full_name: string | null;
  branch: string | null;
  build_method: string | null;
  domain: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}[]> {
  return db
    .select({
      id: apps.id,
      project_id: apps.project_id,
      name: apps.name,
      slug: apps.slug,
      status: apps.status,
      git_provider: apps.git_provider,
      repo_full_name: apps.repo_full_name,
      branch: apps.branch,
      build_method: apps.build_method,
      domain: apps.domain,
      created_at: apps.created_at,
      updated_at: apps.updated_at,
    })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(projects.owner_id, userId));
}

/**
 * Returns the last `limit` builds for an app, ordered newest first.
 */
export async function listBuildsForApp(
  db: Db,
  appId: string,
  limit = 10,
): Promise<BuildRow[]> {
  return db
    .select()
    .from(builds)
    .where(eq(builds.app_id, appId))
    .orderBy(desc(builds.created_at))
    .limit(limit);
}
