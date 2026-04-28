// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { memberships, projects, users } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"
import { signAccessToken, ACCESS_COOKIE } from "../auth/jwt"

mock.module("../license/verify", () => ({
  InvalidLicenseError: class InvalidLicenseError extends Error {},
  verifyLicenseJwt: mock(async () => ({
    license_id: "license-test",
    plan: "enterprise",
    seats: 25,
    exp: Math.floor(Date.now() / 1000) + 86_400,
  })),
}))

import { createLicenseRouter } from "./license"

const skip = !TEST_PG_URL
if (skip) console.log("[license.test] PLOYDOK_TEST_PG_URL not set — skipping")

async function insertUser(db: Db, emailPrefix: string) {
  const id = `${emailPrefix}-${nanoid(6)}`
  const now = new Date()
  await db.insert(users).values({
    id,
    email: `${emailPrefix}-${id}@test.com`,
    display_name: emailPrefix,
    created_at: now,
    updated_at: now,
    recovery_token_hash: null,
    recovery_expires_at: null,
  })
  return { id, email: `${emailPrefix}-${id}@test.com` }
}

async function insertOrg(db: Db, ownerId: string) {
  const id = `org-${nanoid(6)}`
  await db.insert(projects).values({
    id,
    owner_id: ownerId,
    name: `Org ${id}`,
    slug: `org-${id}`,
    created_at: new Date(),
  })
  return id
}

async function insertMembership(
  db: Db,
  orgId: string,
  userId: string,
  role: "owner" | "member"
) {
  const now = new Date()
  await db.insert(memberships).values({
    id: nanoid(),
    org_id: orgId,
    user_id: userId,
    role,
    invited_by: null,
    invited_at: now,
    accepted_at: now,
  })
}

async function buildAuthCookie(userId: string, email: string) {
  const token = await signAccessToken({
    userId,
    email,
    sessionId: `sess-${nanoid(6)}`,
  })
  return `${ACCESS_COOKIE}=${encodeURIComponent(token)}`
}

function buildApp(db: Db) {
  const app = new Hono()
  app.route("/license", createLicenseRouter(db))
  return app
}

describe.skipIf(skip)("license routes", () => {
  let db: Db

  beforeEach(async () => {
    const result = await makeTestDb()
    db = result.db
  })

  it("returns 403 for a non-owner even if another owner exists", async () => {
    const owner = await insertUser(db, "owner")
    const member = await insertUser(db, "member")
    const orgId = await insertOrg(db, owner.id)
    await insertMembership(db, orgId, owner.id, "owner")
    await insertMembership(db, orgId, member.id, "member")

    const app = buildApp(db)
    const res = await app.request("/license/activate", {
      method: "POST",
      headers: {
        cookie: await buildAuthCookie(member.id, member.email),
        "content-type": "application/json",
      },
      body: JSON.stringify({ jwt: "valid.jwt.token" }),
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain("owners")
  })

  it("returns 200 for an accepted owner and activates the license", async () => {
    const owner = await insertUser(db, "owner")
    const orgId = await insertOrg(db, owner.id)
    await insertMembership(db, orgId, owner.id, "owner")

    const app = buildApp(db)
    const res = await app.request("/license/activate", {
      method: "POST",
      headers: {
        cookie: await buildAuthCookie(owner.id, owner.email),
        "content-type": "application/json",
      },
      body: JSON.stringify({ jwt: "valid.jwt.token" }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      plan: string
      message: string
    }
    expect(body.success).toBe(true)
    expect(body.plan).toBe("enterprise")
    expect(body.message).toContain("License activated")
  })
})
