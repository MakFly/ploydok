// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import { createDb } from "@ploydok/db"
import { listAuditEventsForOrg, getMembership } from "@ploydok/db/queries"
import { env } from "../env"
import type { AuthUser } from "../auth/middleware"

const db = createDb(env.DATABASE_URL)

export const auditRouter = new Hono()

/**
 * GET /audit?orgId=&limit=&cursor=&actionPrefix=&targetType=
 *
 * Lists audit events for an organization (requires ownership).
 * Uses cursor-based pagination for efficient scrolling.
 */
auditRouter.get("/", async (c: Context) => {
  const user = c.get("user") as AuthUser
  const orgId = c.req.query("orgId")
  const limitStr = c.req.query("limit") ?? "50"
  const cursorStr = c.req.query("cursor")
  const actionPrefix = c.req.query("actionPrefix")
  const targetType = c.req.query("targetType")

  if (!orgId) {
    throw new HTTPException(400, { message: "orgId query parameter required" })
  }

  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200)
  const cursor = cursorStr ? parseInt(cursorStr, 10) : undefined

  // Verify ownership: user must be an accepted owner of THIS org (audit_log is
  // keyed by project.id, which is what the client sends as orgId). Binding the
  // check to the requested orgId prevents cross-tenant audit reads.
  const membership = await getMembership(db, orgId, user.id)
  if (!membership || !membership.accepted_at || membership.role !== "owner") {
    throw new HTTPException(403, { message: "Access denied" })
  }

  const { events, nextCursor } = await listAuditEventsForOrg(db, orgId, {
    limit,
    ...(cursor !== undefined && { cursor }),
    ...(actionPrefix && { actionPrefix }),
    ...(targetType && { targetType }),
  })

  return c.json({
    events,
    nextCursor,
  })
})
