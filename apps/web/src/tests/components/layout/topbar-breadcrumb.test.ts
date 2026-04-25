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
  it("prefixes the dashboard with the Platform group", () => {
    expect(resolveTopbarBreadcrumb("/dashboard", null)).toEqual([
      { label: "Platform" },
      { label: "Dashboard" },
    ])
  })

  it("builds the root settings breadcrumb without a sidebar group", () => {
    expect(resolveTopbarBreadcrumb("/settings", null)).toEqual([
      { label: "Settings" },
    ])
  })

  it("builds the nested git provider breadcrumb", () => {
    expect(
      resolveTopbarBreadcrumb("/settings/git-providers/github", null)
    ).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Git providers", to: "/settings/git-providers" },
      { label: "GitHub" },
    ])
  })

  it("builds the nested security breadcrumb", () => {
    expect(resolveTopbarBreadcrumb("/settings/security/passkey", null)).toEqual(
      [
        { label: "Settings", to: "/settings" },
        { label: "Security", to: "/settings/security" },
        { label: "Passkeys" },
      ]
    )
  })

  it("builds the posture security breadcrumb", () => {
    expect(resolveTopbarBreadcrumb("/settings/security/posture", null)).toEqual(
      [
        { label: "Settings", to: "/settings" },
        { label: "Security", to: "/settings/security" },
        { label: "Posture" },
      ]
    )
  })

  it("builds the apps list breadcrumb under Platform", () => {
    expect(resolveTopbarBreadcrumb("/apps", null)).toEqual([
      { label: "Platform" },
      { label: "Applications" },
    ])
  })

  it("builds the app breadcrumb with the dynamic app name", () => {
    expect(
      resolveTopbarBreadcrumb("/apps/app-123/settings", "Billing API")
    ).toEqual([
      { label: "Platform" },
      { label: "Applications", to: "/apps" },
      { label: "Billing API", to: "/apps/app-123/overview" },
      { label: "Settings" },
    ])
  })

  it("treats the app overview route as the current page", () => {
    expect(
      resolveTopbarBreadcrumb("/apps/app-123/overview", "Billing API")
    ).toEqual([
      { label: "Platform" },
      { label: "Applications", to: "/apps" },
      { label: "Billing API", to: "/apps/app-123/overview" },
      { label: "Overview" },
    ])
  })

  it("builds the databases breadcrumb for org-scoped routes", () => {
    expect(resolveTopbarBreadcrumb("/orgs/acme/databases", null)).toEqual([
      { label: "Platform" },
      { label: "Databases" },
    ])
  })

  it("builds the database detail breadcrumb with the id", () => {
    expect(resolveTopbarBreadcrumb("/databases/db-123", null)).toEqual([
      { label: "Platform" },
      { label: "Databases", to: "/databases" },
      { label: "db-123" },
    ])
  })

  it("builds the services breadcrumb under Platform", () => {
    expect(resolveTopbarBreadcrumb("/services", null)).toEqual([
      { label: "Platform" },
      { label: "Services" },
    ])
  })

  it("builds the service detail breadcrumb with the id", () => {
    expect(resolveTopbarBreadcrumb("/services/svc-1", null)).toEqual([
      { label: "Platform" },
      { label: "Services", to: "/services" },
      { label: "svc-1" },
    ])
  })

  it("falls back to the app id when no name is loaded", () => {
    expect(resolveTopbarBreadcrumb("/apps/app-xyz", null)).toEqual([
      { label: "Platform" },
      { label: "Applications", to: "/apps" },
      { label: "app-xyz" },
    ])
  })

  it("builds the monitoring breadcrumb under Platform", () => {
    expect(resolveTopbarBreadcrumb("/monitoring", null)).toEqual([
      { label: "Platform" },
      { label: "Monitoring" },
    ])
  })

  it("builds the docker breadcrumb under Platform", () => {
    expect(resolveTopbarBreadcrumb("/docker", null)).toEqual([
      { label: "Platform" },
      { label: "Docker" },
    ])
  })

  it("builds the marketplace breadcrumb under Platform", () => {
    expect(resolveTopbarBreadcrumb("/orgs/acme/marketplace", null)).toEqual([
      { label: "Platform" },
      { label: "Marketplace" },
    ])
  })

  it("builds workspace-group breadcrumbs", () => {
    expect(resolveTopbarBreadcrumb("/members", null)).toEqual([
      { label: "Workspace" },
      { label: "Members" },
    ])
    expect(resolveTopbarBreadcrumb("/audit", null)).toEqual([
      { label: "Workspace" },
      { label: "Audit" },
    ])
    expect(resolveTopbarBreadcrumb("/shared-env", null)).toEqual([
      { label: "Workspace" },
      { label: "Shared env" },
    ])
    expect(resolveTopbarBreadcrumb("/scheduled-jobs", null)).toEqual([
      { label: "Workspace" },
      { label: "Scheduled jobs" },
    ])
    expect(resolveTopbarBreadcrumb("/event-webhooks", null)).toEqual([
      { label: "Workspace" },
      { label: "Event webhooks" },
    ])
  })

  it("returns no breadcrumb for routes outside the supported topbar map", () => {
    expect(resolveTopbarBreadcrumb("/login", null)).toEqual([])
  })
})
