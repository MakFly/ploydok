// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { ApiError, SessionExpiredError } from "../../lib/api"
import {
  redirectIfAuthenticated,
  requireMe,
  requireOnboardedSession,
  resolvePostAuthPath,
} from "../../lib/auth-guards"
import { organizationDashboardPath } from "../../lib/organizations"
import type { Me } from "@ploydok/shared"

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
  is_instance_admin: false,
}

const providersReady = {
  ready: true,
  github: { configured: true, connected: true },
  gitlab: { configured: false, connected: false },
}

const providersMissing = {
  ready: false,
  github: { configured: true, connected: false },
  gitlab: { configured: false, connected: false },
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
      redirectIfAuthenticated(
        async () => fakeMe,
        async () => providersReady
      )
    ).rejects.toMatchObject({
      options: { href: organizationDashboardPath("test-user") },
    })
  })

  it("redirectIfAuthenticated sends authenticated users without a provider to onboarding", async () => {
    await expect(
      redirectIfAuthenticated(
        async () => fakeMe,
        async () => providersMissing
      )
    ).rejects.toMatchObject({
      options: { href: "/onboarding" },
    })
  })

  it("resolvePostAuthPath blocks an explicit redirect until onboarding is complete", () => {
    expect(resolvePostAuthPath(fakeMe, providersMissing, "/settings")).toBe(
      "/onboarding"
    )
    expect(resolvePostAuthPath(fakeMe, providersReady, "/settings")).toBe(
      "/settings"
    )
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

// The _authed layout must gate the whole app on a connected Git provider. The
// onboarding wizard is self-contained, so no path is exempt — an earlier
// version whitelisted /settings/git-providers and that leaked the app shell to
// users who had not onboarded.
describe("requireOnboardedSession", () => {
  it("returns the user once a provider is connected", async () => {
    await expect(
      requireOnboardedSession(
        async () => fakeMe,
        async () => providersReady
      )
    ).resolves.toEqual(fakeMe)
  })

  it("redirects to onboarding when no provider is connected", async () => {
    await expect(
      requireOnboardedSession(
        async () => fakeMe,
        async () => providersMissing
      )
    ).rejects.toMatchObject({ options: { to: "/onboarding" } })
  })

  it("redirects to login before even probing providers", async () => {
    let providersProbed = false
    await expect(
      requireOnboardedSession(
        async () => {
          throw new ApiError(401, "UNAUTHENTICATED", "Not logged in")
        },
        async () => {
          providersProbed = true
          return providersReady
        }
      )
    ).rejects.toMatchObject({ options: { to: "/login" } })
    expect(providersProbed).toBe(false)
  })

  it("surfaces infra errors instead of faking an onboarding redirect", async () => {
    const err = new TypeError("Network down")
    await expect(
      requireOnboardedSession(
        async () => fakeMe,
        async () => {
          throw err
        }
      )
    ).rejects.toBe(err)
  })
})
