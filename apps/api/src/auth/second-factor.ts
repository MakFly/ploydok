// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto"
import type { Context, Next } from "hono"
import { and, desc, eq, sql } from "drizzle-orm"
import { totp_secrets, audit_log } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { getTotpSecret } from "./totp-storage"
import { verifyCodeDetailed } from "./totp"
import type { AuthUser } from "./middleware"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SECOND_FACTOR_COOKIE = "ploydok_2fa_verified"
const TTL_MS = 15 * 60 * 1000 // 15 minutes

// ---------------------------------------------------------------------------
// Cookie signature helpers (HMAC-SHA256, SESSION_SECRET)
// Format: base64url(JSON payload) + "." + hex(HMAC)
// ---------------------------------------------------------------------------

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url")
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8")
}

function sign(payload: string): string {
  const hmac = createHmac("sha256", env.SESSION_SECRET)
  hmac.update(payload)
  return hmac.digest("hex")
}

interface CookiePayload {
  user_id: string
  verified_at: number // ms epoch
}

export function buildSecondFactorCookie(userId: string): string {
  const payload = b64urlEncode(JSON.stringify({ user_id: userId, verified_at: Date.now() }))
  const hmac = sign(payload)
  const value = `${payload}.${hmac}`
  const isSecure = env.NODE_ENV === "prod"
  const maxAge = TTL_MS / 1000
  const parts = [
    `${SECOND_FACTOR_COOKIE}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (isSecure) parts.push("Secure")
  return parts.join("; ")
}

/**
 * Parse and verify the signed cookie.
 * Returns the payload if valid and not expired, null otherwise.
 */
function parseCookieValue(raw: string): CookiePayload | null {
  const decoded = decodeURIComponent(raw)
  const dotIdx = decoded.lastIndexOf(".")
  if (dotIdx === -1) return null

  const payload = decoded.slice(0, dotIdx)
  const hmac = decoded.slice(dotIdx + 1)

  const expectedHmac = sign(payload)
  // Constant-time comparison
  try {
    const a = Buffer.from(hmac, "hex")
    const b = Buffer.from(expectedHmac, "hex")
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(b64urlDecode(payload))
  } catch {
    return null
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["user_id"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["verified_at"] !== "number"
  ) {
    return null
  }

  return parsed as CookiePayload
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return out
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

async function consumeTotpStep(
  db: Db,
  userId: string,
  step: number,
): Promise<"ok" | "replayed"> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`totp:${userId}`}), ${step})`
    )

    const rows = await tx
      .select({
        metadata: audit_log.metadata,
      })
      .from(audit_log)
      .where(
        and(
          eq(audit_log.user_id, userId),
          eq(audit_log.action, "2fa.verified"),
          eq(audit_log.target_type, "user"),
          eq(audit_log.target_id, userId)
        )
      )
      .orderBy(desc(audit_log.created_at))
      .limit(8)

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.metadata) as { totp_step?: number }
        if (parsed.totp_step === step) {
          return "replayed"
        }
      } catch {
        continue
      }
    }

    await tx.insert(audit_log).values({
      user_id: userId,
      action: "2fa.verified",
      target_type: "user",
      target_id: userId,
      metadata: JSON.stringify({ totp_step: step }),
      created_at: new Date(),
    })

    return "ok"
  })
}

function buildReplayResponse(c: Context) {
  return c.json(
    {
      code: "totp_replayed",
      message: "TOTP code already used for this time window",
    },
    403
  )
}

function buildUnavailableResponse(c: Context) {
  return c.json(
    {
      error: {
        code: "SECOND_FACTOR_UNAVAILABLE",
        message: "Unable to persist TOTP verification",
      },
    },
    503
  )
}

function buildTotpRequiredResponse(c: Context) {
  return c.json(
    { code: "totp_required", message: "Second factor required" },
    403
  )
}

/**
 * Hono middleware that enforces a fresh TOTP second-factor check.
 *
 * Must be applied AFTER requireAuth (relies on c.get("user")).
 *
 * Check order:
 *  1. Cookie `ploydok_2fa_verified` — fresh (≤ 15 min) + signed + matching user → pass.
 *  2. Header `X-TOTP-Code` — verifies against stored TOTP secret, consumes the accepted
 *     30s step exactly once via audit_log + advisory lock, sets cookie + pass.
 *  3. Otherwise → 403 { code: "totp_required" }.
 */
export function requireTotpVerified(db: Db) {
  return async (c: Context, next: Next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (c as any).get("user") as AuthUser | undefined
    if (!user) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
        401,
      )
    }

    // 1. Check signed cookie
    const cookieHeader = c.req.raw.headers.get("cookie") ?? ""
    const cookies = parseCookies(cookieHeader)
    const rawCookie = cookies[SECOND_FACTOR_COOKIE]

    if (rawCookie) {
      const payload = parseCookieValue(rawCookie)
      if (
        payload !== null &&
        payload.user_id === user.id &&
        Date.now() - payload.verified_at <= TTL_MS
      ) {
        return next()
      }
    }

    // 2. Check X-TOTP-Code header
    const totpCode = c.req.raw.headers.get("X-TOTP-Code")
    if (totpCode) {
      // User must have TOTP enrolled and verified
      const totpRow = await getTotpSecret(db, user.id)
      if (totpRow && totpRow.verifiedAt !== null) {
        const verification = verifyCodeDetailed(totpRow.secret, totpCode)
        if (verification.ok && verification.matchedStep !== undefined) {
          try {
            const result = await consumeTotpStep(
              db,
              user.id,
              verification.matchedStep
            )
            if (result === "replayed") {
              return buildReplayResponse(c)
            }
          } catch {
            return buildUnavailableResponse(c)
          }

          const cookieStr = buildSecondFactorCookie(user.id)
          c.header("Set-Cookie", cookieStr)
          return next()
        }
      }
    }

    // 3. Reject
    return buildTotpRequiredResponse(c)
  }
}
