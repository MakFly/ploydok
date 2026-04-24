// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import type { Db } from "@ploydok/db"
import { projects, users } from "@ploydok/db"
import {
  getInvitationByTokenHash,
  markInvitationAccepted,
  insertMembership,
} from "@ploydok/db/queries"
import { AcceptInvitationBodySchema } from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { createHash } from "crypto"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function createInvitationsRouter(db: Db): Hono {
  const router = new Hono()

  // GET /invitations/preview?token=... — public endpoint to preview invitation
  router.get("/preview", async (c) => {
    const token = c.req.query("token")
    if (!token) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Token required" } },
        400
      )
    }

    const tokenHash = hashToken(token)
    const invitation = await getInvitationByTokenHash(db, tokenHash)

    if (!invitation) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Invitation not found" } },
        404
      )
    }

    // Check expiration
    if (invitation.expires_at < new Date()) {
      return c.json(
        { error: { code: "GONE", message: "Invitation has expired" } },
        410
      )
    }

    // Get org and inviter details
    const orgRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, invitation.org_id))
      .limit(1)
    const org = orgRows[0]

    const inviterRows = await db
      .select()
      .from(users)
      .where(eq(users.id, invitation.invited_by))
      .limit(1)
    const inviter = inviterRows[0]

    if (!org || !inviter) {
      return c.json(
        {
          error: { code: "NOT_FOUND", message: "Invitation context not found" },
        },
        404
      )
    }

    return c.json({
      org_name: org.name,
      inviter_email: inviter.email,
      role: invitation.role,
      email: invitation.email,
      expires_at: invitation.expires_at.toISOString(),
    })
  })

  // POST /invitations/accept — accept invitation (requires auth)
  router.post("/accept", async (c) => {
    const user = getUser(c)

    const body = await c.req.json().catch(() => null)
    const parsed = AcceptInvitationBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid accept payload",
          },
        },
        400
      )
    }

    const tokenHash = hashToken(parsed.data.token)
    const invitation = await getInvitationByTokenHash(db, tokenHash)

    if (!invitation) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Invitation not found" } },
        404
      )
    }

    // Check expiration
    if (invitation.expires_at < new Date()) {
      return c.json(
        { error: { code: "GONE", message: "Invitation has expired" } },
        410
      )
    }

    // Verify email matches
    if (invitation.email !== user.email) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Invitation email does not match your email",
          },
        },
        403
      )
    }

    // Create membership
    await insertMembership(db, {
      id: nanoid(),
      org_id: invitation.org_id,
      user_id: user.id,
      role: invitation.role,
      invited_by: invitation.invited_by,
      invited_at: new Date(),
      accepted_at: new Date(),
    })

    // Mark invitation as accepted
    await markInvitationAccepted(db, invitation.id)

    // Get org details for response
    const orgRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, invitation.org_id))
      .limit(1)
    const org = orgRows[0]

    if (!org) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }

    return c.json({
      organization: {
        id: org.id,
        slug: org.slug,
        name: org.name,
      },
    })
  })

  return router
}
