// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { users, sessions } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { nanoid } from "nanoid"
import { createAuthRouter } from "./auth"
import { createSession } from "../auth/sessions"
import { REFRESH_COOKIE } from "../auth/jwt"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"

const skip = !TEST_PG_URL
if (skip) console.log("[routes/auth.test] PLOYDOK_TEST_PG_URL not set - skipping")

describe.skipIf(skip)("POST /auth/refresh", () => {
  let db: Db
  let app: Hono
  let userId: string

  beforeEach(async () => {
    const result = await makeTestDb()
    db = result.db
    app = new Hono()
    app.route("/", createAuthRouter(db))
    userId = `refresh-${nanoid(6)}`
    const now = new Date()
    await db
      .insert(users)
      .values({
        id: userId,
        email: `${userId}@test.local`,
        display_name: "Refresh User",
        created_at: now,
        updated_at: now,
        recovery_token_hash: null,
        recovery_expires_at: null,
      })
      .onConflictDoNothing()
  })

  async function requestRefresh(sessionId: string, refreshToken: string): Promise<Response> {
    return app.request("/auth/refresh", {
      method: "POST",
      headers: {
        cookie: `${REFRESH_COOKIE}=${encodeURIComponent(`${sessionId}:${refreshToken}`)}`,
      },
    })
  }

  it("allows only one concurrent refresh and rejects the loser", async () => {
    const { sessionId, refreshToken } = await createSession(db, {
      userId,
      userAgent: "TestAgent",
      ip: "127.0.0.1",
    })

    const responses = await Promise.all([
      requestRefresh(sessionId, refreshToken),
      requestRefresh(sessionId, refreshToken),
    ])

    expect(responses.map((res) => res.status).sort()).toEqual([200, 401])
  })

  it("revokes the session when an old refresh token is replayed", async () => {
    const { sessionId, refreshToken } = await createSession(db, {
      userId,
      userAgent: "TestAgent",
      ip: "127.0.0.1",
    })

    const first = await requestRefresh(sessionId, refreshToken)
    expect(first.status).toBe(200)

    const replay = await requestRefresh(sessionId, refreshToken)
    expect(replay.status).toBe(401)

    const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
    expect(rows[0]?.revoked_at).toBeInstanceOf(Date)
  })
})
