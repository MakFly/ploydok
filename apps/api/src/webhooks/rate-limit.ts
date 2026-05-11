// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, Next } from "hono"
import type { createRedis } from "@ploydok/db"
import { nanoid } from "nanoid"

type Redis = ReturnType<typeof createRedis>

export interface RateLimitKey {
  key: string
  windowSec?: number
  max?: number
}

export interface RateLimiterOpts {
  redis: Redis
  windowSec: number
  max: number
  keyPrefix: string
  keyFrom: (c: Context) => string | RateLimitKey | null
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
}

export async function checkRateLimit(
  redis: Redis,
  key: string,
  windowSec: number,
  max: number,
): Promise<RateLimitResult> {
  const nowMs = Date.now()
  const windowMs = windowSec * 1000
  const cutoff = nowMs - windowMs

  await redis.zremrangebyscore(key, 0, cutoff)
  const count = await redis.zcard(key)

  if (count >= max) {
    return { allowed: false, remaining: 0 }
  }

  const member = `${nowMs}:${nanoid()}`
  await redis.zadd(key, nowMs, member)
  await redis.expire(key, windowSec * 2)

  return { allowed: true, remaining: max - count - 1 }
}

export function createRateLimiter(opts: RateLimiterOpts) {
  const { redis, windowSec, max, keyPrefix, keyFrom } = opts

  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawKeyResult = keyFrom(c)
    if (rawKeyResult === null) {
      return next()
    }

    const rawKey =
      typeof rawKeyResult === "string" ? rawKeyResult : rawKeyResult.key
    const effectiveWindowSec =
      typeof rawKeyResult === "string"
        ? windowSec
        : (rawKeyResult.windowSec ?? windowSec)
    const effectiveMax =
      typeof rawKeyResult === "string" ? max : (rawKeyResult.max ?? max)
    const redisKey = `${keyPrefix}:${rawKey}`
    const nowMs = Date.now()
    const windowMs = effectiveWindowSec * 1000
    const cutoff = nowMs - windowMs

    await redis.zremrangebyscore(redisKey, 0, cutoff)
    const count = await redis.zcard(redisKey)

    const resetTs = Math.ceil((nowMs + windowMs) / 1000)

    if (count >= effectiveMax) {
      c.header("Retry-After", String(effectiveWindowSec))
      c.header("X-RateLimit-Limit", String(effectiveMax))
      c.header("X-RateLimit-Remaining", "0")
      c.header("X-RateLimit-Reset", String(resetTs))
      return c.json({ code: "rate_limited", retry_after: effectiveWindowSec }, 429)
    }

    const member = `${nowMs}:${nanoid()}`
    await redis.zadd(redisKey, nowMs, member)
    await redis.expire(redisKey, effectiveWindowSec * 2)

    c.header("X-RateLimit-Limit", String(effectiveMax))
    c.header("X-RateLimit-Remaining", String(effectiveMax - count - 1))
    c.header("X-RateLimit-Reset", String(resetTs))

    return next()
  }
}

export function rateLimitKeyFromProviderHeaderOrIp(
  c: Context,
  providerHeader: string,
  isValidProviderKey: (value: string) => boolean,
): string | RateLimitKey {
  const providerValue = c.req.header(providerHeader)?.trim() ?? ""
  if (providerValue && isValidProviderKey(providerValue)) {
    return `provider:${providerValue}`
  }

  const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  const realIp = c.req.header("x-real-ip")?.trim()
  const ip = forwardedFor || realIp
  if (ip) return `ip:${ip}`

  return { key: "ip:unknown", max: 10 }
}
