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

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local cutoff = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local member = ARGV[3]
local maximum = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
local count = redis.call('ZCARD', key)
if count >= maximum then
  return {0, 0}
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return {1, maximum - count - 1}
`

export async function checkRateLimit(
  redis: Redis,
  key: string,
  windowSec: number,
  max: number
): Promise<RateLimitResult> {
  const nowMs = Date.now()
  const windowMs = windowSec * 1000
  const cutoff = nowMs - windowMs

  const member = `${nowMs}:${nanoid()}`
  const result = (await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    cutoff,
    nowMs,
    member,
    max,
    windowSec * 2
  )) as [number, number]
  return { allowed: result[0] === 1, remaining: Number(result[1]) }
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
    const result = await checkRateLimit(
      redis,
      redisKey,
      effectiveWindowSec,
      effectiveMax
    )

    const resetTs = Math.ceil((nowMs + windowMs) / 1000)

    if (!result.allowed) {
      c.header("Retry-After", String(effectiveWindowSec))
      c.header("X-RateLimit-Limit", String(effectiveMax))
      c.header("X-RateLimit-Remaining", "0")
      c.header("X-RateLimit-Reset", String(resetTs))
      return c.json(
        { code: "rate_limited", retry_after: effectiveWindowSec },
        429
      )
    }

    c.header("X-RateLimit-Limit", String(effectiveMax))
    c.header("X-RateLimit-Remaining", String(result.remaining))
    c.header("X-RateLimit-Reset", String(resetTs))

    return next()
  }
}

export function rateLimitKeyFromProviderHeaderOrIp(
  c: Context,
  providerHeader: string,
  isValidProviderKey: (value: string) => boolean
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
