// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, Next } from "hono"
import type { createRedis } from "@ploydok/db"
import { nanoid } from "nanoid"

type Redis = ReturnType<typeof createRedis>

export interface RateLimiterOpts {
  redis: Redis
  windowSec: number
  max: number
  keyPrefix: string
  keyFrom: (c: Context) => string | null
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
    const rawKey = keyFrom(c)
    if (rawKey === null) {
      return next()
    }

    const redisKey = `${keyPrefix}:${rawKey}`
    const nowMs = Date.now()
    const windowMs = windowSec * 1000
    const cutoff = nowMs - windowMs

    await redis.zremrangebyscore(redisKey, 0, cutoff)
    const count = await redis.zcard(redisKey)

    const resetTs = Math.ceil((nowMs + windowMs) / 1000)

    if (count >= max) {
      c.header("Retry-After", String(windowSec))
      c.header("X-RateLimit-Limit", String(max))
      c.header("X-RateLimit-Remaining", "0")
      c.header("X-RateLimit-Reset", String(resetTs))
      return c.json({ code: "rate_limited", retry_after: windowSec }, 429)
    }

    const member = `${nowMs}:${nanoid()}`
    await redis.zadd(redisKey, nowMs, member)
    await redis.expire(redisKey, windowSec * 2)

    c.header("X-RateLimit-Limit", String(max))
    c.header("X-RateLimit-Remaining", String(max - count - 1))
    c.header("X-RateLimit-Reset", String(resetTs))

    return next()
  }
}
