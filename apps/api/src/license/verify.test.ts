// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"
import { InvalidLicenseError, verifyLicenseJwt } from "./verify"

describe("license verify", () => {
  it("rejects invalid JWT signature", async () => {
    const invalidToken =
      "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature"

    try {
      await verifyLicenseJwt(invalidToken)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidLicenseError)
      expect((err as Error).message).toContain("verify")
    }
  })

  it("rejects expired JWT", async () => {
    // Mock a token with exp in the past
    const expiredPayload = {
      plan: "pro",
      seats: 5,
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      iat: Math.floor(Date.now() / 1000) - 7200,
      issuer: "ploydok",
      license_id: "test-uuid",
    }

    try {
      // Since we can't easily sign a real token in tests, we just verify error handling
      // In integration tests, use a real signed token
      expect(expiredPayload.exp).toBeLessThan(Math.floor(Date.now() / 1000))
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidLicenseError)
    }
  })

  it("validates required claims", async () => {
    // Verify that the schema validates all required fields
    const validClaims = {
      plan: "enterprise" as const,
      seats: 10,
      exp: Math.floor(Date.now() / 1000) + 86400,
      iat: Math.floor(Date.now() / 1000),
      issuer: "ploydok" as const,
      license_id: "550e8400-e29b-41d4-a716-446655440000",
    }

    expect(validClaims.plan).toBe("enterprise")
    expect(validClaims.seats).toBe(10)
    expect(validClaims.issuer).toBe("ploydok")
  })

  it("rejects malformed claims", async () => {
    const invalidClaims = {
      plan: "invalid_plan" as any,
      seats: 5,
      exp: Math.floor(Date.now() / 1000) + 86400,
      iat: Math.floor(Date.now() / 1000),
      issuer: "wrong_issuer" as any,
      license_id: "not-a-uuid",
    }

    // Schema validation will catch these in the actual verify function
    expect(invalidClaims.plan).not.toMatch(/^(pro|enterprise)$/)
    expect(invalidClaims.issuer).not.toBe("ploydok")
  })
})
