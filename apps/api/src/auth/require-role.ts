// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, Next } from "hono"
import { eq } from "drizzle-orm"
import { getMembership } from "@ploydok/db/queries"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "./middleware"

/**
 * Must be called after requireAuth.
 * Checks that the user holds one of the required roles in the organization,
 * via an *accepted* membership (pending invites do not grant access).
 * Resolves the org identifier from whichever param the route uses
 * (`:slug` / `:orgId` / `:orgSlug` / `:projectId`), accepting a slug or a raw
 * project id, then stashes `org_id` and `membership_role` in the context for
 * downstream handlers to reuse.
 * Returns 404 if the org does not exist, 403 FORBIDDEN otherwise.
 *
 * This is the single authorization gate for org-scoped routes. Handlers must
 * NOT re-implement role checks inline — read `c.get("membership_role")` when a
 * finer decision is needed.
 *
 * Lives in its own module (not middleware.ts) so importing it into route files
 * does not pull in the heavier auth chain (backup-codes, webauthn, …).
 */
export function requireRole(db: Db, roles: Array<"owner" | "member">) {
  return async (c: Context, next: Next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (c as any).get("user") as AuthUser | undefined
    if (!user) {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required",
          },
        },
        401
      )
    }

    // Resolve the org identifier from whichever param names the route uses.
    // The API is inconsistent (:slug, :orgId, :orgSlug, :projectId) and some
    // params carry a slug while others carry a raw project id, so we accept
    // either form: try slug first, then fall back to id.
    const ident =
      c.req.param("slug") ??
      c.req.param("orgId") ??
      c.req.param("orgSlug") ??
      c.req.param("projectId")

    if (!ident) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Organization ID required" } },
        400
      )
    }

    const { projects } = await import("@ploydok/db")
    const bySlug = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, ident))
      .limit(1)
    let orgId = bySlug[0]?.id
    if (!orgId) {
      const byId = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, ident))
        .limit(1)
      orgId = byId[0]?.id
    }

    if (!orgId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }

    const membership = await getMembership(db, orgId, user.id)
    const role = membership?.role
    const isActive = Boolean(membership?.accepted_at)
    const authorized =
      isActive &&
      (role === "owner" || role === "member") &&
      roles.includes(role)

    if (!authorized) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        403
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("org_id", orgId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("membership_role", role)

    return next()
  }
}
