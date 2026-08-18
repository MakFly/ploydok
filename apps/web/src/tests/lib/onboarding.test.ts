// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { onboardingDashboardHref } from "../../lib/onboarding"

describe("onboardingDashboardHref", () => {
  it("opens the OCI image creation flow in the selected workspace", () => {
    expect(onboardingDashboardHref("acme", "image")).toBe(
      "/orgs/acme/dashboard?create=image"
    )
  })

  it("keeps the exact GitLab choice in the creation flow", () => {
    expect(onboardingDashboardHref("acme", "gitlab")).toBe(
      "/orgs/acme/dashboard?create=gitlab"
    )
  })
})
