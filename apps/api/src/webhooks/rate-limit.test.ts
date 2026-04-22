// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { Hono } from "hono"
import { createRedis } from "@ploydok/db"
import { env } from "../env"
import { createRateLimiter, checkRateLimit } from "./rate-limit"

const REDIS_URL = Bun.env["PLOYDOK_TEST_REDIS_URL"] ?? env.REDIS_URL

const redis = createRedis(REDIS_URL)

const PREFIX = "test:ratelimit"

async function flushTestKeys(prefix: string) {
  const keys = await redis.keys(`${prefix}:*`)
  if (keys.length > 0) {
    await redis.del(...keys)
  }
}

afterAll(async () => {
  await flushTestKeys(PREFIX)
  await redis.quit()
})

// ---------------------------------------------------------------------------
// checkRateLimit direct
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  beforeEach(async () => {
    await flushTestKeys(PREFIX)
  })

  it("allows requests up to max", async () => {
    const key = `${PREFIX}:check-basic`
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(redis, key, 60, 5)
      expect(result.allowed).toBe(true)
    }
  })

  it("blocks the (max+1)th request", async () => {
    const key = `${PREFIX}:check-block`
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(redis, key, 60, 5)
    }
    const result = await checkRateLimit(redis, key, 60, 5)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it("purges old entries after windowSec", async () => {
    const key = `${PREFIX}:check-expire`
    const windowSec = 1

    // Fill window to max
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(redis, key, windowSec, 3)
    }

    // Manually backdate all entries so they fall outside the window
    const nowMs = Date.now()
    const expired = nowMs - (windowSec * 1000 + 100)

    const members = await redis.zrange(key, 0, -1)
    for (const m of members) {
      await redis.zadd(key, expired, m)
    }

    // Now the window should be empty → allow again
    const result = await checkRateLimit(redis, key, windowSec, 3)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// createRateLimiter middleware (via Hono)
// ---------------------------------------------------------------------------

function buildApp(windowSec: number, max: number, keyPrefix: string) {
  const app = new Hono()
  const limiter = createRateLimiter({
    redis,
    windowSec,
    max,
    keyPrefix,
    keyFrom: (c) => c.req.header("x-test-key") ?? null,
  })
  app.use("*", limiter)
  app.get("/ping", (c) => c.json({ ok: true }))
  return app
}

describe("createRateLimiter middleware", () => {
  beforeEach(async () => {
    await flushTestKeys(PREFIX)
  })

  it("passes 100 requests within limit", async () => {
    const app = buildApp(60, 100, `${PREFIX}:mw-100`)
    for (let i = 0; i < 100; i++) {
      const res = await app.request("/ping", {
        headers: { "x-test-key": "installation-1" },
      })
      expect(res.status).toBe(200)
    }
  })

  it("returns 429 on the 101st request with Retry-After header", async () => {
    const app = buildApp(60, 100, `${PREFIX}:mw-101`)
    for (let i = 0; i < 100; i++) {
      await app.request("/ping", { headers: { "x-test-key": "installation-1" } })
    }
    const res = await app.request("/ping", {
      headers: { "x-test-key": "installation-1" },
    })
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("60")
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0")
    const body = (await res.json()) as { code: string; retry_after: number }
    expect(body.code).toBe("rate_limited")
    expect(typeof body.retry_after).toBe("number")
  })

  it("does not affect a different key (different installation)", async () => {
    const app = buildApp(60, 2, `${PREFIX}:mw-isolation`)
    // Fill key A to max
    for (let i = 0; i < 2; i++) {
      await app.request("/ping", { headers: { "x-test-key": "installation-A" } })
    }
    // Key A should be blocked
    const resA = await app.request("/ping", { headers: { "x-test-key": "installation-A" } })
    expect(resA.status).toBe(429)
    // Key B should still pass
    const resB = await app.request("/ping", { headers: { "x-test-key": "installation-B" } })
    expect(resB.status).toBe(200)
  })

  it("lets all through when keyFrom returns null", async () => {
    const app = new Hono()
    const limiter = createRateLimiter({
      redis,
      windowSec: 60,
      max: 1,
      keyPrefix: `${PREFIX}:mw-null`,
      keyFrom: () => null,
    })
    app.use("*", limiter)
    app.get("/ping", (c) => c.json({ ok: true }))

    // max=1 but keyFrom=null → all requests pass regardless
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/ping")
      expect(res.status).toBe(200)
    }
  })

  it("purges old entries after window expires, allowing new requests", async () => {
    const app = buildApp(1, 2, `${PREFIX}:mw-expire`)

    // Fill to max
    for (let i = 0; i < 2; i++) {
      await app.request("/ping", { headers: { "x-test-key": "inst-expire" } })
    }

    // Backdate all entries so they're outside the 1s window
    const key = `${PREFIX}:mw-expire:inst-expire`
    const nowMs = Date.now()
    const members = await redis.zrange(key, 0, -1)
    for (const m of members) {
      await redis.zadd(key, nowMs - 2000, m)
    }

    // Should now be allowed again
    const res = await app.request("/ping", { headers: { "x-test-key": "inst-expire" } })
    expect(res.status).toBe(200)
  })
})
