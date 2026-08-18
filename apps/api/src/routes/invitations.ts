// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"
import { Hono } from "hono"
import { eq, sql } from "drizzle-orm"
import type { Db } from "@ploydok/db"
import { projects, users } from "@ploydok/db"
import {
  getInvitationByTokenHash,
  claimInvitationByTokenHash,
  insertMembershipIfAbsent,
} from "@ploydok/db/queries"
import {
  AcceptInvitationBodySchema,
  RegisterFromInvitationBodySchema,
} from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { createHash } from "crypto"
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  buildCookieStr,
  getAccessExpiresAt,
  shouldUseSecureCookies,
  signAccessToken,
} from "../auth/jwt"
import { hashPassword, validateAdminPassword } from "../auth/password"
import { createSession } from "../auth/sessions"

const secureCookies = shouldUseSecureCookies()

class InvitationUnavailableError extends Error {}
class InvitationDeliveryActiveError extends Error {}

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function setAuthCookies(
  headers: Headers,
  accessToken: string,
  refreshToken: string,
  sessionId: string
): void {
  headers.append(
    "Set-Cookie",
    buildCookieStr(ACCESS_COOKIE, accessToken, ACCESS_MAX_AGE, secureCookies)
  )
  headers.append(
    "Set-Cookie",
    buildCookieStr(
      REFRESH_COOKIE,
      `${sessionId}:${refreshToken}`,
      REFRESH_MAX_AGE,
      secureCookies
    )
  )
}

function clientInfo(req: Request): { userAgent: string; ip: string } {
  return {
    userAgent: req.headers.get("user-agent") ?? "unknown",
    ip: req.headers.get("x-forwarded-for") ?? "unknown",
  }
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

  // POST /invitations/register — create the invited account and authenticate it.
  // The email is always taken from the invitation, never from the request body.
  // Account, session, invitation claim and membership are committed together.
  router.post("/register", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = RegisterFromInvitationBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid registration payload",
          },
        },
        400
      )
    }

    const invitation = await getInvitationByTokenHash(
      db,
      hashToken(parsed.data.token)
    )
    if (!invitation) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Invitation not found" } },
        404
      )
    }
    if (invitation.expires_at < new Date()) {
      return c.json(
        { error: { code: "GONE", message: "Invitation has expired" } },
        410
      )
    }

    const passwordError = validateAdminPassword(parsed.data.password)
    if (passwordError) {
      return c.json(
        { error: { code: "PASSWORD_POLICY", message: passwordError } },
        400
      )
    }

    const email = invitation.email.trim().toLowerCase()
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(btrim(${users.email})) = ${email}`)
      .limit(1)
    if (existing.length > 0) {
      return c.json(
        {
          error: {
            code: "ACCOUNT_EXISTS",
            message: "An account already exists for this invitation email",
          },
        },
        409
      )
    }

    const now = new Date()
    const user = {
      id: nanoid(),
      email,
      display_name: parsed.data.display_name,
    }
    const passwordHash = await hashPassword(parsed.data.password)

    let registration: {
      sessionId: string
      refreshToken: string
      accessToken: string
      organization: { id: string; slug: string; name: string }
    }
    try {
      registration = await db.transaction(async (tx) => {
        const claimResult = await claimInvitationByTokenHash(
          tx,
          hashToken(parsed.data.token),
          now
        )
        if (claimResult.status === "busy") {
          throw new InvitationDeliveryActiveError()
        }
        if (claimResult.status !== "claimed") {
          throw new InvitationUnavailableError()
        }
        const claimed = claimResult.invitation
        if (claimed.email.trim().toLowerCase() !== email) {
          throw new InvitationUnavailableError()
        }

        await tx.insert(users).values({
          ...user,
          password_hash: passwordHash,
          is_instance_admin: false,
          created_at: now,
          updated_at: now,
          recovery_token_hash: null,
          recovery_expires_at: null,
        })
        const { userAgent, ip } = clientInfo(c.req.raw)
        const session = await createSession(tx, {
          userId: user.id,
          userAgent,
          ip,
        })
        await insertMembershipIfAbsent(tx, {
          id: nanoid(),
          org_id: claimed.org_id,
          user_id: user.id,
          role: claimed.role,
          invited_by: claimed.invited_by,
          invited_at: now,
          accepted_at: now,
        })

        const orgRows = await tx
          .select({ id: projects.id, slug: projects.slug, name: projects.name })
          .from(projects)
          .where(eq(projects.id, claimed.org_id))
          .limit(1)
        const org = orgRows[0]
        if (!org) throw new InvitationUnavailableError()

        const accessToken = await signAccessToken({
          userId: user.id,
          email: user.email,
          sessionId: session.sessionId,
        })
        return { ...session, accessToken, organization: org }
      })
    } catch (error) {
      if (error instanceof InvitationDeliveryActiveError) {
        c.header("Retry-After", "5")
        return c.json(
          {
            error: {
              code: "INVITATION_DELIVERY_ACTIVE",
              message: "Invitation delivery is active; retry acceptance",
            },
          },
          409
        )
      }
      if (error instanceof InvitationUnavailableError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Invitation not found" } },
          404
        )
      }
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : null
      if (code === "23505") {
        return c.json(
          {
            error: {
              code: "ACCOUNT_EXISTS",
              message: "An account already exists for this invitation email",
            },
          },
          409
        )
      }
      throw error
    }

    const { sessionId, refreshToken, accessToken, organization } = registration
    const accessExpiresAt = getAccessExpiresAt()
    const response = c.newResponse(
      JSON.stringify({ user, accessExpiresAt, organization }),
      201,
      { "Content-Type": "application/json" }
    )
    setAuthCookies(response.headers, accessToken, refreshToken, sessionId)
    return response
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
    if (
      invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
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

    // Membership and token consumption are one unit: a transient failure must
    // not leave a member with a still-replayable invitation (or the inverse).
    try {
      await db.transaction(async (tx) => {
        const acceptedAt = new Date()
        const claimResult = await claimInvitationByTokenHash(
          tx,
          tokenHash,
          acceptedAt
        )
        if (claimResult.status === "busy") {
          throw new InvitationDeliveryActiveError()
        }
        if (claimResult.status !== "claimed") {
          throw new InvitationUnavailableError()
        }
        const claimed = claimResult.invitation
        if (
          claimed.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
        ) {
          throw new InvitationUnavailableError()
        }
        await insertMembershipIfAbsent(tx, {
          id: nanoid(),
          org_id: claimed.org_id,
          user_id: user.id,
          role: claimed.role,
          invited_by: claimed.invited_by,
          invited_at: acceptedAt,
          accepted_at: acceptedAt,
        })
      })
    } catch (error) {
      if (error instanceof InvitationDeliveryActiveError) {
        c.header("Retry-After", "5")
        return c.json(
          {
            error: {
              code: "INVITATION_DELIVERY_ACTIVE",
              message: "Invitation delivery is active; retry acceptance",
            },
          },
          409
        )
      }
      if (error instanceof InvitationUnavailableError) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Invitation not found" } },
          404
        )
      }
      throw error
    }

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
