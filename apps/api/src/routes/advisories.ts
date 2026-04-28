// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import {
  apps,
  cve_advisories,
  cve_matches,
  memberships,
  projects,
} from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"
import { cveRefreshQueue } from "../worker/queues"
import { cveScanEnabled } from "../advisories/service"

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.user_id, userId), inArray(memberships.role, ["owner"]))
    )
    .limit(1)
  return rows.length > 0
}

async function canAccessOrgApp(
  db: Db,
  params: { userId: string; orgSlug: string; appId: string }
): Promise<boolean> {
  const rows = await db
    .select({ app_id: apps.id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .innerJoin(memberships, eq(memberships.org_id, projects.id))
    .where(
      and(
        eq(projects.slug, params.orgSlug),
        eq(apps.id, params.appId),
        eq(memberships.user_id, params.userId)
      )
    )
    .limit(1)
  return rows.length > 0
}

export function createAdvisoriesRouter(db: Db): Hono<AppEnv> {
  const router = new Hono<AppEnv>()

  router.get("/admin/advisories", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)
    if (!(await isAdmin(db, user.id))) {
      return c.json({ error: "admin_required" }, 403)
    }

    if (!cveScanEnabled()) {
      return c.json({ disabled: true, matches: [] })
    }

    const severity = c.req.query("severity")
    const acknowledged = c.req.query("acknowledged")

    const conditions = []
    if (severity) conditions.push(eq(cve_matches.severity_level, severity as never))
    if (acknowledged !== "true") conditions.push(isNull(cve_matches.acknowledged_at))
    conditions.push(isNull(cve_matches.fixed_at))

    const rows = await db
      .select({
        match: cve_matches,
        advisory: cve_advisories,
        app_name: apps.name,
        app_slug: apps.slug,
        org_slug: projects.slug,
      })
      .from(cve_matches)
      .innerJoin(cve_advisories, eq(cve_matches.advisory_id, cve_advisories.id))
      .leftJoin(apps, eq(cve_matches.app_id, apps.id))
      .leftJoin(projects, eq(cve_matches.project_id, projects.id))
      .where(and(...conditions))
      .orderBy(desc(cve_matches.last_seen_at))
      .limit(250)

    return c.json({ disabled: false, matches: rows })
  })

  router.post("/admin/advisories/refresh", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)
    if (!(await isAdmin(db, user.id))) {
      return c.json({ error: "admin_required" }, 403)
    }
    if (!cveScanEnabled()) {
      return c.json({ disabled: true }, 202)
    }

    const job = await cveRefreshQueue.add("cve.refresh", {
      requestedByUserId: user.id,
      source: "api",
    })
    return c.json({ queued: true, jobId: job.id }, 202)
  })

  router.post("/admin/advisories/:matchId/acknowledge", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)
    if (!(await isAdmin(db, user.id))) {
      return c.json({ error: "admin_required" }, 403)
    }

    const body = (await c.req.json().catch(() => ({}))) as { note?: string }
    const [row] = await db
      .update(cve_matches)
      .set({
        acknowledged_at: new Date(),
        acknowledged_by: user.id,
        acknowledged_note: body.note?.slice(0, 1000) ?? null,
      })
      .where(eq(cve_matches.id, c.req.param("matchId")))
      .returning()

    if (!row) return c.json({ error: "not_found" }, 404)
    return c.json({ match: row })
  })

  router.get("/organizations/:orgSlug/apps/:appId/advisories", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)
    const orgSlug = c.req.param("orgSlug")
    const appId = c.req.param("appId")

    if (!(await canAccessOrgApp(db, { userId: user.id, orgSlug, appId }))) {
      return c.json({ error: "not_found" }, 404)
    }
    if (!cveScanEnabled()) {
      return c.json({ disabled: true, matches: [] })
    }

    const rows = await db
      .select({ match: cve_matches, advisory: cve_advisories })
      .from(cve_matches)
      .innerJoin(cve_advisories, eq(cve_matches.advisory_id, cve_advisories.id))
      .where(
        and(
          eq(cve_matches.app_id, appId),
          isNull(cve_matches.acknowledged_at),
          isNull(cve_matches.fixed_at)
        )
      )
      .orderBy(desc(cve_matches.last_seen_at))
      .limit(250)

    return c.json({ disabled: false, matches: rows })
  })

  return router
}
