// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { projects } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { UpdateOrgBrandingSchema } from "@ploydok/shared"
import {
  getOrgBranding,
  upsertOrgBranding,
  deleteOrgBranding,
  hasRole,
} from "@ploydok/db/queries"
import { requireFeature } from "../billing/feature-gate"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("branding.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBrandingRouter(db: Db): Hono<any, any, any> {
  const router = new Hono<AppEnv>()

  // GET /orgs/:slug/branding
  router.get("/orgs/:slug/branding", async (c) => {
    const user = getUser(c)
    const slug = c.req.param("slug")

    const org = await db.query.projects.findFirst({
      where: eq(projects.slug, slug),
    })

    if (!org || !(await hasRole(db, org.id, user.id, ["owner"]))) {
      return c.json({ error: "Organization not found" }, { status: 404 })
    }

    const branding = await getOrgBranding(db, org.id)

    return c.json(
      {
        branding: branding ?? {
          org_id: org.id,
          app_name: "Ploydok",
          logo_url: null,
          primary_color: null,
          favicon_url: null,
        },
      },
      { status: 200 }
    )
  })

  // PUT /orgs/:slug/branding
  router.put(
    "/orgs/:slug/branding",
    requireFeature(db, "whitelabel"),
    async (c) => {
      const user = getUser(c)
      const slug = c.req.param("slug")

      const org = await db.query.projects.findFirst({
        where: eq(projects.slug, slug),
      })

      if (!org || !(await hasRole(db, org.id, user.id, ["owner"]))) {
        return c.json({ error: "Organization not found" }, { status: 404 })
      }

      const body = await c.req.json().catch(() => null)
      const parsed = UpdateOrgBrandingSchema.safeParse(body)

      if (!parsed.success) {
        return c.json(
          { error: "Invalid request body", details: parsed.error.flatten() },
          { status: 400 }
        )
      }

      const branding = await upsertOrgBranding(db, org.id, parsed.data)

      return c.json({ branding }, { status: 200 })
    }
  )

  // DELETE /orgs/:slug/branding
  router.delete(
    "/orgs/:slug/branding",
    requireFeature(db, "whitelabel"),
    async (c) => {
      const user = getUser(c)
      const slug = c.req.param("slug")

      const org = await db.query.projects.findFirst({
        where: eq(projects.slug, slug),
      })

      if (!org || !(await hasRole(db, org.id, user.id, ["owner"]))) {
        return c.json({ error: "Organization not found" }, { status: 404 })
      }

      await deleteOrgBranding(db, org.id)

      return c.json({ success: true }, { status: 200 })
    }
  )

  return router
}
