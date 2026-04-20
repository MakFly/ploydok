// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"
import {
  generateSecret,
  encodeBase32,
  decodeBase32,
  computeCode,
  verifyCode,
  buildOtpauthUrl,
  TOTP_PERIOD_S,
  TOTP_DIGITS,
} from "./totp"

// ---------------------------------------------------------------------------
// 1. generateSecret
// ---------------------------------------------------------------------------

describe("generateSecret", () => {
  it("returns a base32 string of 32 characters for 20 raw bytes", () => {
    // 20 bytes * 8 bits / 5 bits-per-char = 32 base32 chars (no padding)
    const secret = generateSecret()
    expect(typeof secret).toBe("string")
    expect(secret.length).toBe(32)
  })

  it("uses only valid base32 characters", () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
  })

  it("generates unique secrets", () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// 2. encodeBase32 / decodeBase32
// ---------------------------------------------------------------------------

describe("encodeBase32 / decodeBase32", () => {
  it('encodes "Hello!" to JBSWY3DPEE (RFC 4648 base32, no padding)', () => {
    // "Hello!" = 0x48 0x65 0x6c 0x6c 0x6f 0x21 (6 bytes = 48 bits → 10 chars no-pad)
    // Verified: Math.ceil(6 * 8 / 5) = 10 chars
    const buf = Buffer.from("Hello!", "utf8")
    const encoded = encodeBase32(buf)
    expect(encoded).toBe("JBSWY3DPEE")
  })

  it("round-trips known bytes correctly", () => {
    const original = Buffer.from("Hello!", "utf8")
    const decoded = decodeBase32(encodeBase32(original))
    expect(decoded).toEqual(original)
  })

  it("round-trips random bytes correctly", () => {
    // Use a fixed seed-like buffer for reproducibility
    const original = Buffer.from([
      0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 0x01, 0x23,
    ])
    const encoded = encodeBase32(original)
    const decoded = decodeBase32(encoded)
    expect(decoded).toEqual(original)
  })

  it("round-trips an empty buffer", () => {
    const empty = Buffer.alloc(0)
    expect(encodeBase32(empty)).toBe("")
    expect(decodeBase32("")).toEqual(empty)
  })

  it("decodeBase32 is case-insensitive", () => {
    const original = Buffer.from("Hello!", "utf8")
    const lower = encodeBase32(original).toLowerCase()
    expect(decodeBase32(lower)).toEqual(original)
  })

  it("decodeBase32 ignores padding characters", () => {
    const original = Buffer.from("Hello!", "utf8")
    const withPadding = encodeBase32(original) + "==="
    expect(decodeBase32(withPadding)).toEqual(original)
  })

  it("decodeBase32 throws on invalid characters", () => {
    expect(() => decodeBase32("JBSWY3DP!INVALID")).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. computeCode — RFC 6238 Appendix B test vectors (SHA-1)
// ---------------------------------------------------------------------------

describe("computeCode — RFC 6238 vectors", () => {
  // RFC 6238 Appendix B: seed for SHA-1 is ASCII "12345678901234567890"
  // base32-encoded: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  // Note: RFC vectors are 8-digit TOTP; our impl is 6-digit.
  // We verify the 6-digit truncation matches the last 6 digits of the 8-digit RFC value.

  const SECRET_ASCII = "12345678901234567890"
  // Encode the ASCII secret to base32
  const SECRET_B32 = encodeBase32(Buffer.from(SECRET_ASCII, "ascii"))

  it("has the correct base32 representation of the RFC seed", () => {
    expect(SECRET_B32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
  })

  it("T=59 → counter=1 → RFC value 94287082 → 6-digit = 287082", () => {
    // Unix time 59 → floor(59/30) = 1
    const code = computeCode(SECRET_B32, 59)
    expect(code).toBe("287082")
  })

  it("T=1111111109 → counter=37037037 → RFC value 07081804 → 6-digit = 081804", () => {
    // floor(1111111109/30) = 37037037
    const code = computeCode(SECRET_B32, 1111111109)
    expect(code).toBe("081804")
  })

  it("T=1234567890 → counter=41152263 → RFC value 89005924 → 6-digit = 005924", () => {
    // floor(1234567890/30) = 41152263
    const code = computeCode(SECRET_B32, 1234567890)
    expect(code).toBe("005924")
  })

  it("returns a zero-padded string of length 6", () => {
    const secret = generateSecret()
    const code = computeCode(secret, Date.now() / 1000)
    expect(code.length).toBe(TOTP_DIGITS)
    expect(code).toMatch(/^\d{6}$/)
  })
})

// ---------------------------------------------------------------------------
// 4. verifyCode
// ---------------------------------------------------------------------------

describe("verifyCode", () => {
  // Generate a stable secret for verification tests
  const SECRET = generateSecret()
  // Fix a reference time so tests are deterministic
  const NOW = 1700000000 // arbitrary fixed Unix timestamp

  it("accepts the current code (window=1)", () => {
    const code = computeCode(SECRET, NOW)
    expect(verifyCode(SECRET, code, { nowSec: NOW })).toBe(true)
  })

  it("accepts the previous step code (now - 30s) within window=1", () => {
    const code = computeCode(SECRET, NOW - TOTP_PERIOD_S)
    expect(verifyCode(SECRET, code, { nowSec: NOW })).toBe(true)
  })

  it("accepts the next step code (now + 30s) within window=1", () => {
    const code = computeCode(SECRET, NOW + TOTP_PERIOD_S)
    expect(verifyCode(SECRET, code, { nowSec: NOW })).toBe(true)
  })

  it("rejects a step-2 old code (now - 60s) with default window=1", () => {
    const code = computeCode(SECRET, NOW - 2 * TOTP_PERIOD_S)
    expect(verifyCode(SECRET, code, { nowSec: NOW })).toBe(false)
  })

  it("accepts a step-2 old code when window=2 is explicitly set", () => {
    const code = computeCode(SECRET, NOW - 2 * TOTP_PERIOD_S)
    expect(verifyCode(SECRET, code, { nowSec: NOW, window: 2 })).toBe(true)
  })

  it("rejects a non-digit code", () => {
    expect(verifyCode(SECRET, "abc123", { nowSec: NOW })).toBe(false)
  })

  it("rejects a code of wrong length (< 6)", () => {
    expect(verifyCode(SECRET, "12345", { nowSec: NOW })).toBe(false)
  })

  it("rejects a code of wrong length (> 6)", () => {
    expect(verifyCode(SECRET, "1234567", { nowSec: NOW })).toBe(false)
  })

  it("rejects a correct-format but wrong code", () => {
    // Manufacture a code that is definitely wrong by flipping one digit
    const correct = computeCode(SECRET, NOW)
    const flipped = correct
      .split("")
      .map((d, i) => (i === 0 ? String((Number(d) + 1) % 10) : d))
      .join("")
    // Guard: if by unlikely chance they're the same value after flip, skip assertion
    if (flipped !== correct) {
      expect(verifyCode(SECRET, flipped, { nowSec: NOW })).toBe(false)
    }
  })

  it("normalises codes with surrounding whitespace", () => {
    const code = computeCode(SECRET, NOW)
    expect(verifyCode(SECRET, `  ${code}  `, { nowSec: NOW })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. buildOtpauthUrl
// ---------------------------------------------------------------------------

describe("buildOtpauthUrl", () => {
  it("produces the correct otpauth:// URL format", () => {
    const url = buildOtpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "Ploydok",
      accountName: "user@example.com",
    })

    // Label must be percent-encoded
    expect(url).toContain("otpauth://totp/Ploydok%3Auser%40example.com")
    // Mandatory params
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP")
    expect(url).toContain("issuer=Ploydok")
    expect(url).toContain(`period=${TOTP_PERIOD_S}`)
    expect(url).toContain(`digits=${TOTP_DIGITS}`)
    expect(url).toContain("algorithm=SHA1")
  })

  it("matches the exact documented example URL", () => {
    const url = buildOtpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "Ploydok",
      accountName: "user@example.com",
    })
    // URLSearchParams sorts params alphabetically; verify by parsing
    const parsed = new URL(url)
    expect(parsed.protocol).toBe("otpauth:")
    expect(parsed.host).toBe("totp")
    expect(parsed.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP")
    expect(parsed.searchParams.get("issuer")).toBe("Ploydok")
    expect(parsed.searchParams.get("period")).toBe("30")
    expect(parsed.searchParams.get("digits")).toBe("6")
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1")
  })
})
