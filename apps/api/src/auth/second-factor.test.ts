// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { users, totp_secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"
import { requireAuth } from "./middleware"
import { signAccessToken, ACCESS_COOKIE } from "./jwt"
import { requireTotpVerified, SECOND_FACTOR_COOKIE, buildSecondFactorCookie } from "./second-factor"
import { generateSecret } from "./totp"
import { saveTotpSecret, markTotpVerified } from "./totp-storage"
import { computeCode } from "./totp"
import { resetAllTotpFailuresForTests } from "./totp-throttle"

const skip = !TEST_PG_URL
if (skip) console.log("[second-factor.test] PLOYDOK_TEST_PG_URL not set — skipping")

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

async function makeApp(db: Db) {
  return new Hono().get(
    "/secure",
    requireAuth(db),
    requireTotpVerified(db),
    (c) => c.json({ ok: true }),
  )
}

async function makeUser(db: Db): Promise<{ userId: string; token: string }> {
  const userId = `sf2-${nanoid(6)}`
  const now = new Date()
  await db.insert(users).values({
    id: userId,
    email: `user-${userId}@test.com`,
    display_name: "Test User",
    created_at: now,
    updated_at: now,
    recovery_token_hash: null,
    recovery_expires_at: null,
  })
  const token = await signAccessToken({
    userId,
    email: `user-${userId}@test.com`,
    sessionId: `sess-${nanoid(6)}`,
  })
  return { userId, token }
}

async function enrollTotp(db: Db, userId: string): Promise<string> {
  const secret = generateSecret()
  await saveTotpSecret(db, userId, secret)
  await markTotpVerified(db, userId)
  return secret
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skip)("requireTotpVerified middleware", () => {
  let db: Db

  beforeEach(async () => {
    const result = await makeTestDb()
    db = result.db
    resetAllTotpFailuresForTests()
  })

  it("403 if neither cookie nor header", async () => {
    const { token } = await makeUser(db)
    const app = await makeApp(db)
    const res = await app.request("/secure", { headers: authHeaders(token) })
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe("totp_required")
  })

  it("403 if cookie is expired (> 15 min)", async () => {
    const { userId, token } = await makeUser(db)
    const app = await makeApp(db)

    // Build cookie manually with old verified_at
    const expiredAt = Date.now() - 16 * 60 * 1000 // 16 minutes ago
    const { env } = await import("../env")
    const { createHmac } = await import("node:crypto")
    function b64urlEncode(s: string) { return Buffer.from(s, "utf8").toString("base64url") }
    const payload = b64urlEncode(JSON.stringify({ user_id: userId, verified_at: expiredAt }))
    const hmac = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex")
    const cookieVal = `${payload}.${hmac}`

    const res = await app.request("/secure", {
      headers: {
        cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}; ${SECOND_FACTOR_COOKIE}=${encodeURIComponent(cookieVal)}`,
      },
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe("totp_required")
  })

  it("403 if cookie belongs to another user", async () => {
    const { token } = await makeUser(db)
    const { userId: otherId } = await makeUser(db)
    const app = await makeApp(db)

    // Build a valid cookie for other user
    const cookieStr = buildSecondFactorCookie(otherId)
    const cookieVal = cookieStr.split(";")[0]!.split("=").slice(1).join("=")

    const res = await app.request("/secure", {
      headers: {
        cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}; ${SECOND_FACTOR_COOKIE}=${cookieVal}`,
      },
    })
    expect(res.status).toBe(403)
  })

  it("403 if cookie signature is invalid", async () => {
    const { userId, token } = await makeUser(db)
    const app = await makeApp(db)

    const { createHmac } = await import("node:crypto")
    function b64urlEncode(s: string) { return Buffer.from(s, "utf8").toString("base64url") }
    const payload = b64urlEncode(JSON.stringify({ user_id: userId, verified_at: Date.now() }))
    const badHmac = createHmac("sha256", "wrong-secret").update(payload).digest("hex")
    const cookieVal = `${payload}.${badHmac}`

    const res = await app.request("/secure", {
      headers: {
        cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}; ${SECOND_FACTOR_COOKIE}=${encodeURIComponent(cookieVal)}`,
      },
    })
    expect(res.status).toBe(403)
  })

  it("200 + Set-Cookie if X-TOTP-Code is valid", async () => {
    const { userId, token } = await makeUser(db)
    const secret = await enrollTotp(db, userId)
    const app = await makeApp(db)

    const code = computeCode(secret, Math.floor(Date.now() / 1000))
    const res = await app.request("/secure", {
      headers: authHeaders(token, { "X-TOTP-Code": code }),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get("Set-Cookie")
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain(SECOND_FACTOR_COOKIE)
  })

  it("403 if the same TOTP code is replayed within the same 30s window", async () => {
    const { userId, token } = await makeUser(db)
    const secret = await enrollTotp(db, userId)
    const app = await makeApp(db)

    const code = computeCode(secret, Math.floor(Date.now() / 1000))

    const first = await app.request("/secure", {
      headers: authHeaders(token, { "X-TOTP-Code": code }),
    })
    expect(first.status).toBe(200)

    const replay = await app.request("/secure", {
      headers: authHeaders(token, { "X-TOTP-Code": code }),
    })
    expect(replay.status).toBe(403)
    const body = await replay.json() as { code: string }
    expect(body.code).toBe("totp_replayed")
  })

  it("403 if X-TOTP-Code is invalid", async () => {
    const { userId, token } = await makeUser(db)
    await enrollTotp(db, userId)
    const app = await makeApp(db)

    const res = await app.request("/secure", {
      headers: authHeaders(token, { "X-TOTP-Code": "000000" }),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe("totp_required")
  })

  it("rate-limits TOTP brute-force after 5 invalid attempts", async () => {
    const { userId, token } = await makeUser(db)
    await enrollTotp(db, userId)
    const app = await makeApp(db)

    for (let index = 0; index < 5; index += 1) {
      const res = await app.request("/secure", {
        headers: authHeaders(token, { "X-TOTP-Code": "000000" }),
      })
      expect(res.status).toBe(403)
    }

    const locked = await app.request("/secure", {
      headers: authHeaders(token, { "X-TOTP-Code": "000000" }),
    })
    expect(locked.status).toBe(429)
    expect(locked.headers.get("Retry-After")).toBeTruthy()
    const body = (await locked.json()) as { error: { code: string } }
    expect(body.error.code).toBe("TOTP_LOCKED")
  })

  it("200 if cookie is valid and fresh (no TOTP re-check needed)", async () => {
    const { userId, token } = await makeUser(db)
    const app = await makeApp(db)

    const cookieStr = buildSecondFactorCookie(userId)
    // Extract the raw value from Set-Cookie string
    const rawVal = cookieStr.split(";")[0]!.split("=").slice(1).join("=")

    const res = await app.request("/secure", {
      headers: {
        cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}; ${SECOND_FACTOR_COOKIE}=${rawVal}`,
      },
    })
    expect(res.status).toBe(200)
  })

  it("403 if user has no TOTP enrolled (totp_secrets row absent)", async () => {
    const { token } = await makeUser(db)
    const app = await makeApp(db)

    // Send an X-TOTP-Code even though user has no TOTP
    const res = await app.request("/secure", {
      headers: authHeaders(token, { "X-TOTP-Code": "123456" }),
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe("totp_required")
  })
})
