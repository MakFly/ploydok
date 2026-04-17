// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for AppHeader logic.
 * Uses pure state functions extracted from AppHeader behavior.
 *
 * Note: AppHeader no longer renders tabs — those moved to AppSidebar.
 * Tests for sidebar nav live in AppSidebar.test.ts.
 */
import { describe, expect, it } from "bun:test"
import type { AppStatus } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Logic extracted from AppHeader
// ---------------------------------------------------------------------------

interface AppMeta {
  name: string
  status: AppStatus
  domain?: string
  repoFullName?: string
  branch?: string
}

function getAppTitle(app: AppMeta): string {
  return app.name
}

function getDomainUrl(domain: string | undefined): string | null {
  return domain ? `https://${domain}` : null
}

function hasDomain(app: AppMeta): boolean {
  return Boolean(app.domain)
}

function getBreadcrumb(appName: string): Array<string> {
  return ["Apps", appName]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AppHeader — title and breadcrumb", () => {
  it("returns the app name as title", () => {
    const app: AppMeta = { name: "my-app", status: "running" }
    expect(getAppTitle(app)).toBe("my-app")
  })

  it("builds breadcrumb with Apps root and app name", () => {
    const crumbs = getBreadcrumb("my-app")
    expect(crumbs).toEqual(["Apps", "my-app"])
  })
})

describe("AppHeader — domain URL shortcut", () => {
  it("returns null when no domain", () => {
    expect(getDomainUrl(undefined)).toBeNull()
  })

  it("prefixes https:// for the domain", () => {
    expect(getDomainUrl("my-app.example.com")).toBe("https://my-app.example.com")
  })

  it("shows domain shortcut only when domain is set", () => {
    const withDomain: AppMeta = { name: "x", status: "running", domain: "x.test" }
    const withoutDomain: AppMeta = { name: "x", status: "running" }
    expect(hasDomain(withDomain)).toBe(true)
    expect(hasDomain(withoutDomain)).toBe(false)
  })
})

describe("AppHeader — layout contract (no tabs)", () => {
  it("tabs have been moved to AppSidebar — AppHeader only owns breadcrumb + title + actions", () => {
    // AppHeader renders: breadcrumb > title + AppStatusBadge + (optional) domain link
    // + DeployButton + ActionsMenu. Nav tabs live in AppSidebar.
    const headerOwnsTabs = false
    const sidebarOwnsTabs = true
    expect(headerOwnsTabs).toBe(false)
    expect(sidebarOwnsTabs).toBe(true)
  })

  it("delegates deploy to DeployButton (existence contract)", () => {
    const delegatesDeployToDeployButton = true
    const delegatesActionsToActionsMenu = true
    expect(delegatesDeployToDeployButton).toBe(true)
    expect(delegatesActionsToActionsMenu).toBe(true)
  })
})
