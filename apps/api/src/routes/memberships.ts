// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import type { Db } from "@ploydok/db"
import { projects } from "@ploydok/db"
import {
  listMembershipsForOrg,
  getMembership,
  removeMembership,
  updateMembershipRole,
  countOwners,
  isOrgOwner,
} from "@ploydok/db/queries"
import {
  InviteBodySchema,
  UpdateRoleBodySchema,
  MembersListResponseSchema,
} from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { sendMail } from "../mailer"
import { renderInvitationEmail } from "../mailer"
import { env } from "../env"
import {
  createInvitation,
  findPendingInvitationByEmail,
  listPendingInvitationsForOrg,
} from "@ploydok/db/queries"
import { createHash } from "crypto"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function createMembershipsRouter(db: Db): Hono {
  const router = new Hono()

  // GET /orgs/:slug/members — list members and pending invitations
  router.get("/:orgId/members", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")

    // Verify user has membership in org
    const membership = await getMembership(db, orgId, user.id)
    if (!membership) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Access denied" } },
        403
      )
    }

    const members = await listMembershipsForOrg(db, orgId)
    const pendingInvitations = await listPendingInvitationsForOrg(db, orgId)

    const response = MembersListResponseSchema.parse({
      members,
      pending_invitations: pendingInvitations,
    })

    return c.json(response)
  })

  // POST /orgs/:slug/members/invite — invite a member (owner only)
  router.post("/:orgId/members/invite", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")

    // Verify user is owner
    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only owners can invite members",
          },
        },
        403
      )
    }

    const body = await c.req.json().catch(() => null)
    const parsed = InviteBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid invite payload",
          },
        },
        400
      )
    }

    // Check if invitation already pending for this email
    const existing = await findPendingInvitationByEmail(
      db,
      orgId,
      parsed.data.email
    )
    if (existing) {
      return c.json(
        {
          error: {
            code: "CONFLICT",
            message: "Invitation already pending for this email",
          },
        },
        409
      )
    }

    // Generate token and hash
    const token = await import("crypto").then((m) =>
      m.randomBytes(32).toString("base64url")
    )
    const tokenHash = hashToken(token)

    // Create invitation
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const invitation = await createInvitation(db, {
      id: nanoid(),
      org_id: orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: expiresAt,
    })

    // Get org details for email
    const orgRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, orgId))
      .limit(1)
    const org = orgRows[0]

    // Send invitation email
    const acceptUrl = `${env.WEB_ORIGIN}/invitations/accept?token=${token}`
    const emailContent = renderInvitationEmail({
      orgName: org?.name ?? "Ploydok",
      inviterName: user.display_name,
      acceptUrl,
      expiresAt,
    })

    await sendMail({
      to: parsed.data.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    })

    return c.json(
      {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires_at: invitation.expires_at.toISOString(),
        },
      },
      201
    )
  })

  // DELETE /orgs/:slug/members/:userId — remove member (owner only)
  router.delete("/:orgId/members/:userId", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")
    const userId = c.req.param("userId")

    // Verify user is owner
    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only owners can remove members",
          },
        },
        403
      )
    }

    // Prevent self-removal if sole owner
    if (user.id === userId) {
      const ownerCount = await countOwners(db, orgId)
      if (ownerCount <= 1) {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Cannot remove yourself while being the sole owner",
            },
          },
          400
        )
      }
    }

    await removeMembership(db, orgId, userId)
    return c.json({})
  })

  // PATCH /orgs/:slug/members/:userId/role — update member role (owner only)
  router.patch("/:orgId/members/:userId/role", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")
    const userId = c.req.param("userId")

    // Verify user is owner
    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: { code: "FORBIDDEN", message: "Only owners can change roles" },
        },
        403
      )
    }

    const body = await c.req.json().catch(() => null)
    const parsed = UpdateRoleBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid role payload" },
        },
        400
      )
    }

    // Prevent downgrading the sole owner
    if (parsed.data.role === "member") {
      const memberToChange = await getMembership(db, orgId, userId)
      if (memberToChange?.role === "owner") {
        const ownerCount = await countOwners(db, orgId)
        if (ownerCount <= 1) {
          return c.json(
            {
              error: {
                code: "BAD_REQUEST",
                message: "Cannot downgrade the sole owner",
              },
            },
            400
          )
        }
      }
    }

    await updateMembershipRole(db, orgId, userId, parsed.data.role)
    return c.json({})
  })

  // DELETE /orgs/:slug/invitations/:invitationId — cancel invitation (owner only)
  router.delete("/:orgId/invitations/:invitationId", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")
    const invitationId = c.req.param("invitationId")

    // Verify user is owner
    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only owners can cancel invitations",
          },
        },
        403
      )
    }

    // Delete invitation (soft-delete by marking as accepted is not needed, just delete)
    const { membership_invitations } = await import("@ploydok/db")
    await db
      .delete(membership_invitations)
      .where(eq(membership_invitations.id, invitationId))

    return c.json({})
  })

  return router
}
