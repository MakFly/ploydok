// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import { apps, projects } from "../schema"
import type { Db } from "../client"

/**
 * Returns the owner_id of the project that contains the given app,
 * or null if the app does not exist.
 * Used by workers — NOT for auth checks.
 */
export async function resolveAppOwner(
  db: Db,
  appId: string
): Promise<string | null> {
  const rows = await db
    .select({ owner_id: projects.owner_id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(apps.id, appId))
    .limit(1)

  return rows[0]?.owner_id ?? null
}
