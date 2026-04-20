// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  extractAppName,
  resolveTopbarBreadcrumb,
  type MatchWithLoader,
} from "../../../components/layout/topbar-breadcrumb"

describe("extractAppName", () => {
  it("reads the app name from the app layout loader data", () => {
    const matches: Array<MatchWithLoader> = [
      { routeId: "/_authed/apps", loaderData: {} },
      {
        routeId: "/_authed/apps/$id",
        loaderData: { app: { name: "Ploydok API" } },
      },
    ]

    expect(extractAppName(matches)).toBe("Ploydok API")
  })

  it("returns null when there is no app loader match", () => {
    expect(extractAppName([])).toBeNull()
  })
})

describe("resolveTopbarBreadcrumb", () => {
  it("builds the root settings breadcrumb", () => {
    expect(resolveTopbarBreadcrumb("/settings", null)).toEqual([
      { label: "Settings" },
    ])
  })

  it("builds the nested git provider breadcrumb", () => {
    expect(resolveTopbarBreadcrumb("/settings/git-providers/github", null)).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Git providers", to: "/settings/git-providers" },
      { label: "GitHub" },
    ])
  })

  it("builds the nested security breadcrumb", () => {
    expect(resolveTopbarBreadcrumb("/settings/security/passkeys", null)).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Security", to: "/settings/security" },
      { label: "Passkeys" },
    ])
  })

  it("builds the app breadcrumb with the dynamic app name", () => {
    expect(resolveTopbarBreadcrumb("/apps/app-123/settings", "Billing API")).toEqual([
      { label: "Apps", to: "/apps" },
      { label: "Billing API", to: "/apps/app-123/overview" },
      { label: "Settings" },
    ])
  })

  it("treats the app overview route as the current page", () => {
    expect(resolveTopbarBreadcrumb("/apps/app-123/overview", "Billing API")).toEqual([
      { label: "Apps", to: "/apps" },
      { label: "Billing API", to: "/apps/app-123/overview" },
      { label: "Overview" },
    ])
  })

  it("returns no breadcrumb for routes outside the supported topbar map", () => {
    expect(resolveTopbarBreadcrumb("/login", null)).toEqual([])
  })
})
