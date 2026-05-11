// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { Hono } from "hono"
import {
  createRateLimiter,
  checkRateLimit,
  rateLimitKeyFromProviderHeaderOrIp,
} from "./rate-limit"

class MemoryRedis {
  private readonly sets = new Map<string, Map<string, number>>()

  async keys(pattern: string): Promise<Array<string>> {
    const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern
    return Array.from(this.sets.keys()).filter((key) => key.startsWith(prefix))
  }

  async del(...keys: Array<string>): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      if (this.sets.delete(key)) deleted += 1
    }
    return deleted
  }

  async zremrangebyscore(
    key: string,
    min: number,
    max: number
  ): Promise<number> {
    const set = this.sets.get(key)
    if (!set) return 0
    let removed = 0
    for (const [member, score] of set) {
      if (score >= min && score <= max) {
        set.delete(member)
        removed += 1
      }
    }
    return removed
  }

  async zcard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.sets.get(key) ?? new Map<string, number>()
    const existed = set.has(member)
    set.set(member, score)
    this.sets.set(key, set)
    return existed ? 0 : 1
  }

  async zrange(key: string, start: number, stop: number): Promise<Array<string>> {
    const members = Array.from(this.sets.get(key)?.entries() ?? [])
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member)
    const end = stop === -1 ? undefined : stop + 1
    return members.slice(start, end)
  }

  async expire(): Promise<number> {
    return 1
  }

  async quit(): Promise<void> {}
}

const redis = new MemoryRedis()

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
      const result = await checkRateLimit(redis as never, key, 60, 5)
      expect(result.allowed).toBe(true)
    }
  })

  it("blocks the (max+1)th request", async () => {
    const key = `${PREFIX}:check-block`
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(redis as never, key, 60, 5)
    }
    const result = await checkRateLimit(redis as never, key, 60, 5)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it("purges old entries after windowSec", async () => {
    const key = `${PREFIX}:check-expire`
    const windowSec = 1

    // Fill window to max
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(redis as never, key, windowSec, 3)
    }

    // Manually backdate all entries so they fall outside the window
    const nowMs = Date.now()
    const expired = nowMs - (windowSec * 1000 + 100)

    const members = await redis.zrange(key, 0, -1)
    for (const m of members) {
      await redis.zadd(key, expired, m)
    }

    // Now the window should be empty → allow again
    const result = await checkRateLimit(redis as never, key, windowSec, 3)
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
    redis: redis as never,
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
      redis: redis as never,
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

  it("rate-limits by IP when the provider header is absent", async () => {
    const app = new Hono()
    const limiter = createRateLimiter({
      redis: redis as never,
      windowSec: 60,
      max: 2,
      keyPrefix: `${PREFIX}:mw-ip-fallback`,
      keyFrom: (c) =>
        rateLimitKeyFromProviderHeaderOrIp(
          c,
          "x-github-hook-installation-target-id",
          (value) => /^\d+$/.test(value),
        ),
    })
    app.use("*", limiter)
    app.post("/webhook", (c) => c.json({ ok: true }))

    for (let index = 0; index < 2; index += 1) {
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
      })
      expect(res.status).toBe(200)
    }

    const blocked = await app.request("/webhook", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
    })
    expect(blocked.status).toBe(429)
  })

  it("uses stricter limits when neither provider header nor IP is available", async () => {
    const app = new Hono()
    const limiter = createRateLimiter({
      redis: redis as never,
      windowSec: 60,
      max: 100,
      keyPrefix: `${PREFIX}:mw-unknown-fallback`,
      keyFrom: (c) =>
        rateLimitKeyFromProviderHeaderOrIp(
          c,
          "x-github-hook-installation-target-id",
          (value) => /^\d+$/.test(value),
        ),
    })
    app.use("*", limiter)
    app.post("/webhook", (c) => c.json({ ok: true }))

    for (let index = 0; index < 10; index += 1) {
      const res = await app.request("/webhook", { method: "POST" })
      expect(res.status).toBe(200)
    }

    const blocked = await app.request("/webhook", { method: "POST" })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("10")
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
