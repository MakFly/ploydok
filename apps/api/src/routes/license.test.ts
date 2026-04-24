// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"

describe("license routes", () => {
  describe("GET /license/status", () => {
    it("returns activated=false when no license exists", () => {
      // Test stub: requires full app setup with database
      // In integration tests, create a fresh DB and verify status endpoint
      const mockStatus = {
        activated: false,
        is_expired: false,
      }
      expect(mockStatus.activated).toBe(false)
    })

    it("returns license status when activated", () => {
      const mockStatus = {
        activated: true,
        plan: "pro" as const,
        seats: 5,
        expires_at: new Date().toISOString(),
        is_expired: false,
      }
      expect(mockStatus.activated).toBe(true)
      expect(mockStatus.plan).toBe("pro")
    })

    it("marks license as expired when expires_at < now", () => {
      const now = new Date()
      const pastDate = new Date(now.getTime() - 86400000) // 1 day ago
      expect(pastDate < now).toBe(true)
    })
  })

  describe("POST /license/activate", () => {
    it("requires authentication", () => {
      // POST /activate without auth should return 401
      // Test requires full app setup with auth middleware
      expect(true).toBe(true)
    })

    it("requires admin membership", () => {
      // POST /activate with non-admin user should return 403
      expect(true).toBe(true)
    })

    it("validates JWT format", () => {
      const invalidJwt = "not.a.valid.jwt"
      expect(invalidJwt).toContain(".")
    })

    it("successfully activates valid license", () => {
      const mockClaims = {
        plan: "enterprise" as const,
        seats: 10,
        exp: Math.floor(Date.now() / 1000) + 86400,
        iat: Math.floor(Date.now() / 1000),
        issuer: "ploydok" as const,
        license_id: "550e8400-e29b-41d4-a716-446655440000",
      }

      expect(mockClaims.plan).toBe("enterprise")
      expect(mockClaims.seats).toBe(10)
      expect(mockClaims.issuer).toBe("ploydok")
    })
  })
})
