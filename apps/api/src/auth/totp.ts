// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TOTP implementation per RFC 6238 with HMAC-SHA1, 30s period, 6 digits.
 *
 * Used as an alternative second-factor option to passkeys + backup codes.
 * Secrets are 160-bit (RFC 4226 recommendation for SHA-1), base32-encoded
 * for display/QR-code compatibility with Google Authenticator / 1Password.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const PERIOD_S = 30
const DIGITS = 6
const SECRET_BYTES = 20 // 160 bits — RFC 4226 §4 recommendation for SHA-1

// Export constants used by callers (tests, endpoints):
export const TOTP_PERIOD_S = PERIOD_S
export const TOTP_DIGITS = DIGITS

// RFC 4648 §6 base32 alphabet
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

// ---------------------------------------------------------------------------
// Base32 encode / decode
// ---------------------------------------------------------------------------

/** Encode raw bytes to RFC 4648 base32 (uppercase, no padding). */
export function encodeBase32(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ""

  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!
    bits += 8

    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(value >>> bits) & 0x1f]
    }
  }

  // Remaining bits (< 5) — pad with zeros on the right
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }

  return output
}

/** Decode RFC 4648 base32 (case-insensitive, ignores padding/whitespace). */
export function decodeBase32(s: string): Buffer {
  const cleaned = s.toUpperCase().replace(/[\s=]/g, "")

  let bits = 0
  let value = 0
  const output: number[] = []

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]!
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) {
      throw new Error(`Invalid base32 character: '${char}'`)
    }

    value = (value << 5) | idx
    bits += 5

    if (bits >= 8) {
      bits -= 8
      output.push((value >>> bits) & 0xff)
    }
  }

  return Buffer.from(output)
}

// ---------------------------------------------------------------------------
// Secret generation
// ---------------------------------------------------------------------------

/** Generate a fresh 160-bit secret, base32-encoded (no padding). */
export function generateSecret(): string {
  return encodeBase32(randomBytes(SECRET_BYTES))
}

// ---------------------------------------------------------------------------
// TOTP core (RFC 4226 + RFC 6238)
// ---------------------------------------------------------------------------

/**
 * Compute the 6-digit TOTP code for the given base32 secret at the given
 * Unix timestamp (seconds). Exposed for testing; most callers use `verifyCode`.
 */
export function computeCode(secret: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / PERIOD_S)

  // Pack counter as 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8)
  // JavaScript bitwise ops work on 32-bit integers, so split into high/low
  const high = Math.floor(counter / 0x100000000)
  const low = counter >>> 0
  counterBuf.writeUInt32BE(high, 0)
  counterBuf.writeUInt32BE(low, 4)

  const keyBuf = decodeBase32(secret)
  const hmac = createHmac("sha1", keyBuf).update(counterBuf).digest()

  // Dynamic truncation — RFC 4226 §5.3
  const offset = hmac[19]! & 0x0f
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!

  const code = bin % Math.pow(10, DIGITS)
  return String(code).padStart(DIGITS, "0")
}

/**
 * Verify `code` against `secret` at `nowSec` with a tolerance window (±N steps).
 * Default window = 1 (accepts current step, prev step, next step) for clock drift.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyCode(
  secret: string,
  code: string,
  opts?: { nowSec?: number; window?: number },
): boolean {
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000)
  const window = opts?.window ?? 1

  // Normalise input
  const normalised = code.trim().replace(/\s/g, "")

  // Reject non-6-digit inputs early
  if (normalised.length !== DIGITS || !/^\d+$/.test(normalised)) {
    return false
  }

  const incoming = Buffer.from(normalised, "utf8")

  for (let i = -window; i <= window; i++) {
    const expected = computeCode(secret, nowSec + i * PERIOD_S)
    const expectedBuf = Buffer.from(expected, "utf8")

    if (timingSafeEqual(expectedBuf, incoming)) {
      return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// OTP Auth URL (for QR codes)
// ---------------------------------------------------------------------------

/**
 * Build the otpauth:// URL for QR display.
 * Format: otpauth://totp/{label}?secret=X&issuer={issuer}&period=30&digits=6&algorithm=SHA1
 * `label` is typically `{issuer}:{user.email}` (RFC 6238 §4 best practice).
 */
export function buildOtpauthUrl(opts: {
  secret: string
  issuer: string
  accountName: string
}): string {
  const { secret, issuer, accountName } = opts
  const label = encodeURIComponent(`${issuer}:${accountName}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    period: String(PERIOD_S),
    digits: String(DIGITS),
    algorithm: "SHA1",
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
