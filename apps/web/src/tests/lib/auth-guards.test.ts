// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { ApiError, SessionExpiredError } from "../../lib/api"
import { redirectIfAuthenticated, requireMe } from "../../lib/auth-guards"
import type { Me } from "@ploydok/shared"
import { organizationDashboardPath } from "../../lib/organizations"

const fakeMe: Me = {
  id: "user-1",
  email: "test@example.com",
  display_name: "Test User",
  created_at: new Date().toISOString(),
  default_organization: {
    id: "org-1",
    name: "Test User",
    slug: "test-user",
    is_default: true,
    created_at: new Date().toISOString(),
  },
  accessExpiresAt: Date.now() + 60_000,
  has_passkey_plus: true,
  has_backup_codes: true,
  has_totp: false,
  require_totp_for_secret_reveal: true,
  needs_second_factor: false,
}

describe("auth route guards", () => {
  it("requireMe returns the user when /me succeeds", async () => {
    await expect(requireMe(async () => fakeMe)).resolves.toEqual(fakeMe)
  })

  it("requireMe redirects to /login on 401", async () => {
    await expect(
      requireMe(async () => {
        throw new ApiError(401, "UNAUTHENTICATED", "Not logged in")
      })
    ).rejects.toMatchObject({
      options: { to: "/login" },
    })
  })

  it("requireMe redirects to /login on SessionExpiredError", async () => {
    await expect(
      requireMe(async () => {
        throw new SessionExpiredError()
      })
    ).rejects.toMatchObject({
      options: { to: "/login" },
    })
  })

  it("requireMe rethrows non-auth errors", async () => {
    const err = new ApiError(500, "SERVER_ERROR", "Boom")
    await expect(
      requireMe(async () => {
        throw err
      })
    ).rejects.toBe(err)
  })

  it("redirectIfAuthenticated redirects authenticated users to the default workspace", async () => {
    await expect(
      redirectIfAuthenticated(async () => fakeMe)
    ).rejects.toMatchObject({
      options: { href: organizationDashboardPath("test-user") },
    })
  })

  it("redirectIfAuthenticated allows public access on 401", async () => {
    await expect(
      redirectIfAuthenticated(async () => {
        throw new ApiError(401, "UNAUTHENTICATED", "Not logged in")
      })
    ).resolves.toBeUndefined()
  })

  it("redirectIfAuthenticated rethrows non-auth errors", async () => {
    const err = new TypeError("Network down")
    await expect(
      redirectIfAuthenticated(async () => {
        throw err
      })
    ).rejects.toBe(err)
  })
})
