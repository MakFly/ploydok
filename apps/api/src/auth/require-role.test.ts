// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, afterAll } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "./middleware"

type MembershipResult = {
  role: "owner" | "member"
  accepted_at: Date | null
} | null

let membershipResult: MembershipResult = null

mock.module("@ploydok/db", () => ({
  projects: {
    id: "id",
    slug: "slug",
  },
}))

mock.module("@ploydok/db/queries", () => ({
  getMembership: async () => membershipResult,
}))

afterAll(() => {
  mock.restore()
})

const { requireRole } = await import("./require-role")

const fakeUser: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  session_id: "session-1",
}

function buildDb(projectRows: Array<{ id: string }>): Db {
  const db = {
    select: () => {
      const chain = {
        from() {
          return chain
        },
        where() {
          return chain
        },
        limit: async () => projectRows,
      }
      return chain
    },
  }
  return db as unknown as Db
}

function buildApp(db: Db, roles: Array<"owner" | "member">, withUser = true) {
  const app = new Hono<{
    Variables: {
      user: AuthUser
      org_id: string
      membership_role: "owner" | "member"
    }
  }>()
  app.use("*", async (c, next) => {
    if (withUser) c.set("user", fakeUser)
    await next()
  })
  app.get("/:orgId/thing", requireRole(db, roles), (c) =>
    c.json({ org_id: c.get("org_id"), role: c.get("membership_role") })
  )
  return app
}

describe("requireRole", () => {
  it("returns 401 when there is no authenticated user", async () => {
    const app = buildApp(buildDb([{ id: "org-a" }]), ["owner"], false)

    const res = await app.request("/org-a/thing")

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    })
  })

  it("returns 404 when the org identifier does not resolve to a project", async () => {
    membershipResult = null
    const app = buildApp(buildDb([]), ["owner"])

    const res = await app.request("/missing-org/thing")

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Organization not found" },
    })
  })

  it("returns 403 when the user has no membership", async () => {
    membershipResult = null
    const app = buildApp(buildDb([{ id: "org-a" }]), ["owner"])

    const res = await app.request("/org-a/thing")

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Insufficient permissions" },
    })
  })

  it("returns 403 when the membership is not accepted yet", async () => {
    membershipResult = { role: "owner", accepted_at: null }
    const app = buildApp(buildDb([{ id: "org-a" }]), ["owner"])

    const res = await app.request("/org-a/thing")

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Insufficient permissions" },
    })
  })

  it("returns 403 when a member hits an owner-only route", async () => {
    membershipResult = { role: "member", accepted_at: new Date() }
    const app = buildApp(buildDb([{ id: "org-a" }]), ["owner"])

    const res = await app.request("/org-a/thing")

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Insufficient permissions" },
    })
  })

  it("returns 200 and stashes context for an accepted owner", async () => {
    membershipResult = { role: "owner", accepted_at: new Date() }
    const app = buildApp(buildDb([{ id: "org-a" }]), ["owner"])

    const res = await app.request("/org-a/thing")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ org_id: "org-a", role: "owner" })
  })

  it("returns 200 for an accepted member on a route open to owner and member", async () => {
    membershipResult = { role: "member", accepted_at: new Date() }
    const app = buildApp(buildDb([{ id: "org-a" }]), ["owner", "member"])

    const res = await app.request("/org-a/thing")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ org_id: "org-a", role: "member" })
  })
})
