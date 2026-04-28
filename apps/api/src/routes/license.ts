// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { and, eq, count, isNotNull } from "drizzle-orm"
import type { Db } from "@ploydok/db"
import { memberships } from "@ploydok/db"
import { activateLicense, getActiveLicense } from "@ploydok/db/queries"
import {
  LicenseActivateRequestSchema,
  LicenseActivateResponseSchema,
  LicenseStatusSchema,
} from "@ploydok/shared"
import { requireScope } from "../auth/require-scope"
import { verifyLicenseJwt, InvalidLicenseError } from "../license/verify"
import { requireAuth, type AuthUser } from "../auth/middleware"
import { childLogger } from "../logger"

const log = childLogger("license.routes")

type LicenseRouterEnv = { Variables: { user?: AuthUser } }

/**
 * Check if user is an admin (owner of at least one org).
 */
async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const ownerCount = await db
    .select({ count: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.user_id, userId),
        eq(memberships.role, "owner"),
        isNotNull(memberships.accepted_at)
      )
    )

  const cnt = ownerCount[0]?.count ?? 0
  return Number(cnt) > 0
}

export function createLicenseRouter(db: Db): Hono<LicenseRouterEnv> {
  const router = new Hono<LicenseRouterEnv>()

  /**
   * GET /license/status
   * Returns the current license status (activated, plan, seats, expiration, is_expired).
   * Public endpoint — no auth required.
   */
  router.get("/status", async (c) => {
    try {
      const license = await getActiveLicense(db)

      if (!license) {
        const response = LicenseStatusSchema.parse({
          activated: false,
          is_expired: false,
        })
        return c.json(response, 200)
      }

      const now = new Date()
      const isExpired = new Date(license.expires_at) < now

      const response = LicenseStatusSchema.parse({
        activated: true,
        plan: license.plan,
        seats: license.seats,
        expires_at: license.expires_at.toISOString(),
        is_expired: isExpired,
      })
      return c.json(response, 200)
    } catch (err) {
      log.error(
        { error: err instanceof Error ? err.message : "unknown" },
        "Failed to get license status"
      )
      return c.json({ error: "Failed to get license status" }, 500)
    }
  })

  /**
   * POST /license/activate
   * Activate a license via JWT.
   * Requires auth — user must be admin (owner of at least one org).
   */
  router.post("/activate", requireAuth(db), requireScope("admin:*"), async (c) => {
    try {
      const user = c.get("user") as AuthUser | undefined
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401)
      }

      // Check if user is admin
      const admin = await isAdmin(db, user.id)
      if (!admin) {
        return c.json(
          { error: "Only organization owners can activate licenses" },
          403
        )
      }

      // Parse request body
      const body = await c.req.json()
      const req = LicenseActivateRequestSchema.parse(body)

      // Verify and parse JWT
      const claims = await verifyLicenseJwt(req.jwt)

      // Activate license in DB
      const activated = await activateLicense(db, {
        license_id: claims.license_id,
        plan: claims.plan,
        seats: claims.seats,
        expires_at: new Date(claims.exp * 1000),
        activated_by: user.id,
        jwt: req.jwt,
      })

      const response = LicenseActivateResponseSchema.parse({
        success: true,
        message: `License activated: ${claims.plan} plan for ${claims.seats} seats`,
        plan: activated.plan,
        expires_at: activated.expires_at.toISOString(),
      })

      log.info(
        {
          license_id: claims.license_id,
          plan: claims.plan,
          user_id: user.id,
        },
        "License activated"
      )

      return c.json(response, 200)
    } catch (err) {
      if (err instanceof InvalidLicenseError) {
        log.warn({ error: err.message }, "License JWT verification failed")
        return c.json(
          {
            success: false,
            message: err.message,
          },
          400
        )
      }

      if (err instanceof Error && err.name === "ZodError") {
        log.warn({ error: err.message }, "Invalid license activation request")
        return c.json(
          {
            success: false,
            message: "Invalid request format",
          },
          400
        )
      }

      log.error(
        { error: err instanceof Error ? err.message : "unknown" },
        "License activation failed"
      )
      return c.json(
        {
          success: false,
          message: "License activation failed",
        },
        500
      )
    }
  })

  return router
}
