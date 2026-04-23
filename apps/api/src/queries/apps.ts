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
  projectId?: string,
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
  const where = projectId
    ? and(eq(projects.owner_id, userId), eq(apps.project_id, projectId))
    : eq(projects.owner_id, userId);
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
    .where(where);
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

// ---------------------------------------------------------------------------
// Activity (derived from builds)
// ---------------------------------------------------------------------------

export type ActivityEventType =
  | "build.started"
  | "build.succeeded"
  | "build.failed"
  | "build.cancelled";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  buildId: string;
  data: {
    message?: string | undefined;
    commitSha?: string | undefined;
    commitMessage?: string | undefined;
    errorMessage?: string | undefined;
  };
}

/**
 * Derives an activity timeline for an app from its build rows. Each terminal
 * build produces two events (started + outcome); pending/running builds emit
 * only the started event.
 *
 * Returns events sorted newest first, capped to `limit`.
 */
export function deriveActivityFromBuilds(
  rows: BuildRow[],
  limit: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const row of rows) {
    const startTs =
      (row.started_at instanceof Date ? row.started_at.getTime() : null) ??
      (row.created_at instanceof Date ? row.created_at.getTime() : null);

    const commitSha = row.commit_sha ?? undefined;
    const commitMessage = row.commit_message ?? undefined;

    if (startTs !== null) {
      events.push({
        id: `${row.id}.started`,
        type: "build.started",
        timestamp: startTs,
        buildId: row.id,
        data: {
          message: commitMessage ?? undefined,
          commitSha,
          commitMessage,
        },
      });
    }

    if (
      (row.status === "succeeded" ||
        row.status === "failed" ||
        row.status === "cancelled") &&
      row.finished_at instanceof Date
    ) {
      const type: ActivityEventType =
        row.status === "succeeded"
          ? "build.succeeded"
          : row.status === "failed"
            ? "build.failed"
            : "build.cancelled";

      events.push({
        id: `${row.id}.${row.status}`,
        type,
        timestamp: row.finished_at.getTime(),
        buildId: row.id,
        data: {
          message:
            row.status === "failed" && row.error_message
              ? row.error_message
              : (commitMessage ?? undefined),
          commitSha,
          commitMessage,
          errorMessage: row.error_message ?? undefined,
        },
      });
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  return events.slice(0, limit);
}

/**
 * Returns recent activity for an app, derived from its builds table.
 * To get N events we read up to N builds (each produces 1-2 events).
 */
export async function getAppActivity(
  db: Db,
  appId: string,
  limit = 20,
): Promise<ActivityEvent[]> {
  const rows = await listBuildsForApp(db, appId, limit);
  return deriveActivityFromBuilds(rows, limit);
}
