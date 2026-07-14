// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, timingSafeEqual } from "node:crypto"
import type { Db } from "@ploydok/db"
import { users } from "@ploydok/db"
import { env } from "../env"

// 30 minutes — long enough for a human to spot the URL in logs, short enough
// to bound the exposure window if logs leak.
const TOKEN_TTL_MS = 30 * 60 * 1000

interface SetupToken {
  value: string
  expires_at: number
  permanent: boolean
}

let current: SetupToken | null = null
let tokenlessBannerPrinted = false

function hasActiveToken(): boolean {
  if (!current) return false
  if (!current.permanent && Date.now() > current.expires_at) {
    current = null
    return false
  }
  return true
}

function newRandom(): string {
  return randomBytes(32).toString("hex")
}

function buildSetupUrl(token: string): string {
  return `${env.WEB_ORIGIN}/setup?token=${token}`
}

export async function bootstrapSetupToken(db: Db): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1)
  if (existing.length > 0) return

  if (!env.PLOYDOK_SETUP_TOKEN_REQUIRED) {
    if (!tokenlessBannerPrinted) {
      tokenlessBannerPrinted = true
      // eslint-disable-next-line no-console
      console.warn(
        [
          "",
          "┌─ Ploydok first boot ─────────────────────────────────────────────────────────┐",
          `│ Open: ${env.WEB_ORIGIN}/setup`,
          "│ Setup token disabled by PLOYDOK_SETUP_TOKEN_REQUIRED=0; rely on firewall/IP allowlist.",
          "└──────────────────────────────────────────────────────────────────────────────┘",
          "",
        ].join("\n")
      )
    }
    return
  }

  if (hasActiveToken()) return

  const fromEnv = Bun.env["PLOYDOK_SETUP_TOKEN"]?.trim()
  const value = fromEnv && fromEnv.length >= 16 ? fromEnv : newRandom()
  current = {
    value,
    expires_at: fromEnv ? Number.POSITIVE_INFINITY : Date.now() + TOKEN_TTL_MS,
    permanent: Boolean(fromEnv),
  }

  const url = buildSetupUrl(value)
  const expiry = fromEnv
    ? "source: PLOYDOK_SETUP_TOKEN (no expiry)"
    : "expires in 30 min — restart api to regenerate"
  // eslint-disable-next-line no-console
  console.warn(
    [
      "",
      "┌─ Ploydok first boot ─────────────────────────────────────────────────────────┐",
      `│ Open: ${url}`,
      `│ ${expiry}`,
      "└──────────────────────────────────────────────────────────────────────────────┘",
      "",
    ].join("\n")
  )
}

export function getSetupTokenState(): {
  active: boolean
  expires_at: number | null
} {
  if (!hasActiveToken()) return { active: false, expires_at: null }
  return {
    active: true,
    expires_at: current!.permanent ? null : current!.expires_at,
  }
}

export function validateSetupToken(presented: string | undefined): boolean {
  if (!current || !presented) return false
  if (!current.permanent && Date.now() > current.expires_at) {
    current = null
    return false
  }
  const a = Buffer.from(presented)
  const b = Buffer.from(current.value)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function consumeSetupToken(presented: string | undefined): boolean {
  if (!validateSetupToken(presented)) return false
  current = null
  return true
}

// Called after a successful first-admin creation to make further setup attempts
// 404 even if the original token is intercepted.
export function clearSetupToken(): void {
  current = null
}

// Test-only — never call from production code.
export function __resetSetupTokenForTest(): void {
  current = null
  tokenlessBannerPrinted = false
}
