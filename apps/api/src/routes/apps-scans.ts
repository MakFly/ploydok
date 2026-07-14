// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getAppForUser, getLatestScanForApp } from "@ploydok/db/queries"
import type { BuildScanRow } from "@ploydok/db"
import { BuildScanSummarySchema } from "@ploydok/shared"
import type { BuildScanSummary } from "@ploydok/shared"
import { env } from "../env"
import type { AuthUser } from "../auth/middleware"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function serializeScan(row: BuildScanRow): BuildScanSummary {
  return BuildScanSummarySchema.parse({
    buildId: row.build_id,
    imageRef: row.image_ref,
    status: row.status,
    critical: row.critical,
    high: row.high,
    medium: row.medium,
    low: row.low,
    unknown: row.unknown,
    startedAt: row.started_at?.toISOString() ?? null,
    scannedAt: row.scanned_at?.toISOString() ?? null,
  })
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAppsScansRouter(db: Db): Hono {
  const router = new Hono()

  // -------------------------------------------------------------------------
  // GET /:id/scans/latest — Most recent Trivy image scan for an app
  // -------------------------------------------------------------------------

  router.get("/:id/scans/latest", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const scan = await getLatestScanForApp(db, appId)

    return c.json({ scan: scan ? serializeScan(scan) : null })
  })

  return router
}

// ---------------------------------------------------------------------------
// Prod singleton
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const appsScansRouter = createAppsScansRouter(prodDb)
