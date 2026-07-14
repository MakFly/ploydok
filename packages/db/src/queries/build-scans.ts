// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, inArray } from "drizzle-orm"
import type { Db } from "../client"
import { build_scans, builds } from "../schema"
import type { BuildScanRow } from "../schema"

/** Scan attached to the app's latest successful build. `null` if absent. */
export async function getLatestScanForApp(
  db: Db,
  appId: string
): Promise<BuildScanRow | null> {
  const latestBuild = await db
    .select({ id: builds.id })
    .from(builds)
    .where(
      and(
        eq(builds.app_id, appId),
        inArray(builds.status, ["succeeded", "succeeded_with_warning"])
      )
    )
    .orderBy(desc(builds.created_at))
    .limit(1)
  const buildId = latestBuild[0]?.id
  if (!buildId) return null

  const rows = await db
    .select()
    .from(build_scans)
    .where(eq(build_scans.build_id, buildId))
    .limit(1)
  return rows[0] ?? null
}

export async function listScansForApp(
  db: Db,
  appId: string,
  limit = 10
): Promise<Array<BuildScanRow>> {
  const rows = await db
    .select({ scan: build_scans })
    .from(build_scans)
    .innerJoin(builds, eq(build_scans.build_id, builds.id))
    .where(eq(builds.app_id, appId))
    .orderBy(desc(build_scans.created_at))
    .limit(limit)
  return rows.map((r) => r.scan)
}
