// SPDX-License-Identifier: AGPL-3.0-only
import { createRedis } from "@ploydok/db"
import { isIP } from "node:net"
import type { Context } from "hono"
import { env } from "../env"
import { createRateLimiter } from "../webhooks/rate-limit"

const redis = createRedis(env.REDIS_URL)

export function trustedClientIp(
  c: Context,
  trustProxyHeaders = env.PLOYDOK_TRUST_PROXY_HEADERS
): string | null {
  if (trustProxyHeaders) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    if (forwarded && isIP(forwarded)) return forwarded
    const realIp = c.req.header("x-real-ip")?.trim()
    if (realIp && isIP(realIp)) return realIp
  }
  const socketIp = (c.env as { remoteAddress?: unknown } | undefined)
    ?.remoteAddress
  return typeof socketIp === "string" && isIP(socketIp) ? socketIp : null
}

export function createInvitationRegisterRateLimit(
  rateLimitRedis: Parameters<typeof createRateLimiter>[0]["redis"],
  options: { trustProxyHeaders?: boolean } = {}
) {
  return createRateLimiter({
    redis: rateLimitRedis,
    windowSec: 60,
    max: 10,
    keyPrefix: "rl:invitation-register",
    keyFrom: (c) => {
      const ip = trustedClientIp(c, options.trustProxyHeaders)
      return ip ? `ip:${ip}` : { key: "ip:unknown", max: 3 }
    },
  })
}

export function createInvitationOwnerRateLimit(
  rateLimitRedis: Parameters<typeof createRateLimiter>[0]["redis"],
  options: { trustProxyHeaders?: boolean } = {}
) {
  return createRateLimiter({
    redis: rateLimitRedis,
    windowSec: 60,
    max: 20,
    keyPrefix: "rl:invitation-owner",
    keyFrom: (c) => {
      const user = c.get("user") as { id?: string } | undefined
      const ip = trustedClientIp(c, options.trustProxyHeaders) ?? "unknown"
      return `user:${user?.id ?? "unknown"}:ip:${ip}`
    },
  })
}

export const invitationRegisterRateLimit =
  createInvitationRegisterRateLimit(redis)
export const invitationOwnerRateLimit = createInvitationOwnerRateLimit(redis)
