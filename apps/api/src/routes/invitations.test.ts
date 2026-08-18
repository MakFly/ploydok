// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"

const projectsTable = { id: "project.id" }
const usersTable = { id: "user.id", email: "user.email" }

let invitation: {
  id: string
  org_id: string
  email: string
  role: string
  invited_by: string
  expires_at: Date
} | null
let existingUser = false
let sessionFailure = false
let claimFailure = false
let claimBusy = false
let membershipFailure = false
const insertedUsers: Array<Record<string, unknown>> = []
const insertedMemberships: Array<Record<string, unknown>> = []
const acceptedInvitations: string[] = []

mock.module("@ploydok/db", () => ({
  projects: projectsTable,
  users: usersTable,
}))

mock.module("@ploydok/db/queries", () => ({
  getInvitationByTokenHash: mock(async () => invitation),
  insertMembershipIfAbsent: mock(
    async (_db: Db, values: Record<string, unknown>) => {
      if (membershipFailure) throw new Error("membership store unavailable")
      insertedMemberships.push(values)
    }
  ),
  claimInvitationByTokenHash: mock(async () => {
    if (claimBusy) return { status: "busy" as const }
    if (claimFailure || !invitation) return { status: "unavailable" as const }
    if (invitation) acceptedInvitations.push(invitation.id)
    return { status: "claimed" as const, invitation }
  }),
}))

mock.module("../auth/password", () => ({
  hashPassword: mock(async () => "password-hash"),
  validateAdminPassword: (password: string) =>
    password.length >= 12 ? null : "Password must be at least 12 characters",
}))

mock.module("../auth/sessions", () => ({
  createSession: mock(async () => {
    if (sessionFailure) throw new Error("session store unavailable")
    return { sessionId: "session-1", refreshToken: "refresh-1" }
  }),
}))

mock.module("../auth/jwt", () => ({
  ACCESS_COOKIE: "ploydok_access",
  ACCESS_MAX_AGE: 600,
  REFRESH_COOKIE: "ploydok_refresh",
  REFRESH_MAX_AGE: 604800,
  buildCookieStr: (name: string, value: string) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`,
  getAccessExpiresAt: () => 1_800_000_000,
  shouldUseSecureCookies: () => false,
  signAccessToken: mock(async () => "access-1"),
}))

const { createInvitationsRouter } = await import("./invitations")

const matchingUser: AuthUser = {
  id: "user-1",
  email: "invitee@example.com",
  display_name: "Invitee",
  session_id: "session-1",
}

function buildDb(): Db {
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === usersTable) {
              return existingUser ? [{ id: "existing-user" }] : []
            }
            return [{ id: "org-1", slug: "acme", name: "Acme" }]
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === usersTable) insertedUsers.push(values)
      },
    }),
    transaction: async (callback: (tx: Db) => Promise<unknown>) => {
      const userCount = insertedUsers.length
      const membershipCount = insertedMemberships.length
      const acceptedCount = acceptedInvitations.length
      try {
        return await callback(fakeDb as unknown as Db)
      } catch (error) {
        insertedUsers.length = userCount
        insertedMemberships.length = membershipCount
        acceptedInvitations.length = acceptedCount
        throw error
      }
    },
  }
  return fakeDb as unknown as Db
}

function buildApp(user?: AuthUser) {
  const app = new Hono<{ Variables: { user: AuthUser } }>()
  app.use("/accept", async (c, next) => {
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
    c.set("user", user)
    return next()
  })
  app.route("/", createInvitationsRouter(buildDb()))
  return app
}

beforeEach(() => {
  invitation = {
    id: "invitation-1",
    org_id: "org-1",
    email: "invitee@example.com",
    role: "member",
    invited_by: "owner-1",
    expires_at: new Date(Date.now() + 60_000),
  }
  existingUser = false
  sessionFailure = false
  claimFailure = false
  claimBusy = false
  membershipFailure = false
  insertedUsers.length = 0
  insertedMemberships.length = 0
  acceptedInvitations.length = 0
})

describe("invitation-bound account creation", () => {
  it("creates the account with the invitation email and authenticates it", async () => {
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Invitation test",
        "x-forwarded-for": "127.0.0.1",
      },
      body: JSON.stringify({
        token: "raw-invitation-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(201)
    expect(insertedUsers).toHaveLength(1)
    expect(insertedUsers[0]).toMatchObject({
      email: "invitee@example.com",
      display_name: "New Member",
      password_hash: "password-hash",
      is_instance_admin: false,
    })
    expect(insertedMemberships).toHaveLength(1)
    expect(insertedMemberships[0]).toMatchObject({
      org_id: "org-1",
      role: "member",
      invited_by: "owner-1",
    })
    expect(acceptedInvitations).toEqual(["invitation-1"])
    expect(response.headers.get("set-cookie")).toContain("ploydok_access=")
    expect(await response.json()).toMatchObject({
      user: { email: "invitee@example.com", display_name: "New Member" },
      organization: { id: "org-1", slug: "acme", name: "Acme" },
    })
  })

  it("does not create an account from an invalid or consumed token", async () => {
    invitation = null
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "consumed-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(404)
    expect(insertedUsers).toHaveLength(0)
  })

  it("does not replace an account already bound to the invited email", async () => {
    existingUser = true
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "raw-invitation-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: "ACCOUNT_EXISTS" },
    })
    expect(insertedUsers).toHaveLength(0)
  })

  it("rolls account creation back when session persistence fails", async () => {
    sessionFailure = true
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "raw-invitation-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(500)
    expect(insertedUsers).toHaveLength(0)
    expect(insertedMemberships).toHaveLength(0)
    expect(acceptedInvitations).toHaveLength(0)
  })

  it("rolls everything back when membership persistence fails", async () => {
    membershipFailure = true
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "raw-invitation-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(500)
    expect(insertedUsers).toHaveLength(0)
    expect(insertedMemberships).toHaveLength(0)
    expect(acceptedInvitations).toHaveLength(0)
  })

  it("does not create an account when the invitation is revoked before claim", async () => {
    claimFailure = true
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "raw-invitation-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(404)
    expect(insertedUsers).toHaveLength(0)
    expect(insertedMemberships).toHaveLength(0)
    expect(acceptedInvitations).toHaveLength(0)
  })

  it("returns a retryable conflict while the invitation email is being sent", async () => {
    claimBusy = true
    const response = await buildApp().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "raw-invitation-token",
        display_name: "New Member",
        password: "correct horse battery staple",
      }),
    })

    expect(response.status).toBe(409)
    expect(response.headers.get("retry-after")).toBe("5")
    expect(await response.json()).toMatchObject({
      error: { code: "INVITATION_DELIVERY_ACTIVE" },
    })
    expect(insertedUsers).toHaveLength(0)
  })
})

describe("authenticated invitation acceptance", () => {
  it("requires an authenticated account", async () => {
    const response = await buildApp().request("/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "raw-invitation-token" }),
    })

    expect(response.status).toBe(401)
    expect(insertedMemberships).toHaveLength(0)
  })

  it("rejects a session whose email differs from the invitation", async () => {
    const response = await buildApp({
      ...matchingUser,
      email: "other@example.com",
    }).request("/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "raw-invitation-token" }),
    })

    expect(response.status).toBe(403)
    expect(insertedMemberships).toHaveLength(0)
    expect(acceptedInvitations).toHaveLength(0)
  })

  it("accepts case-normalized matching email and consumes the invitation", async () => {
    invitation = { ...invitation!, email: "Invitee@Example.com" }
    const response = await buildApp(matchingUser).request("/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "raw-invitation-token" }),
    })

    expect(response.status).toBe(200)
    expect(insertedMemberships).toHaveLength(1)
    expect(insertedMemberships[0]).toMatchObject({
      org_id: "org-1",
      user_id: "user-1",
      role: "member",
    })
    expect(acceptedInvitations).toEqual(["invitation-1"])
    expect(await response.json()).toEqual({
      organization: { id: "org-1", slug: "acme", name: "Acme" },
    })
  })
})
