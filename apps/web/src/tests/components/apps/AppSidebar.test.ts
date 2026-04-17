// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for AppSidebar pure logic.
 * No DOM rendering — tests only the exported helper functions.
 */
import { describe, expect, it } from "bun:test"
import {
  getActiveNavLabel,
  truncateSha,
  buildQuickInfo,
} from "../../../components/apps/AppSidebar"
import type { AppDetail } from "../../../lib/apps"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APP_ID = "abc123"

function makeApp(overrides: Partial<AppDetail> = {}): AppDetail {
  return {
    id: APP_ID,
    name: "my-app",
    slug: "my-app",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getActiveNavLabel
// ---------------------------------------------------------------------------

describe("getActiveNavLabel — active tab detection", () => {
  const items = [
    { label: "Overview", to: "/apps/$id/overview" },
    { label: "Deployments", to: "/apps/$id/deployments" },
    { label: "Logs", to: "/apps/$id/logs" },
    { label: "Settings", to: "/apps/$id/settings" },
    { label: "Env", to: "/apps/$id/env" },
    { label: "Domains", to: "/apps/$id/domains" },
  ]

  it("returns null when no item matches", () => {
    expect(getActiveNavLabel("/apps/abc123", APP_ID, items)).toBeNull()
    expect(getActiveNavLabel("/dashboard", APP_ID, items)).toBeNull()
  })

  it("detects exact match on overview", () => {
    expect(getActiveNavLabel("/apps/abc123/overview", APP_ID, items)).toBe(
      "Overview",
    )
  })

  it("detects exact match on deployments", () => {
    expect(getActiveNavLabel("/apps/abc123/deployments", APP_ID, items)).toBe(
      "Deployments",
    )
  })

  it("detects exact match on logs", () => {
    expect(getActiveNavLabel("/apps/abc123/logs", APP_ID, items)).toBe("Logs")
  })

  it("detects exact match on settings", () => {
    expect(getActiveNavLabel("/apps/abc123/settings", APP_ID, items)).toBe(
      "Settings",
    )
  })

  it("detects exact match on env", () => {
    expect(getActiveNavLabel("/apps/abc123/env", APP_ID, items)).toBe("Env")
  })

  it("detects exact match on domains", () => {
    expect(getActiveNavLabel("/apps/abc123/domains", APP_ID, items)).toBe(
      "Domains",
    )
  })

  it("matches child paths (startsWith) for nested routes", () => {
    expect(
      getActiveNavLabel("/apps/abc123/settings/env", APP_ID, items),
    ).toBe("Settings")
  })

  it("does not match a different app id", () => {
    expect(getActiveNavLabel("/apps/xyz999/overview", APP_ID, items)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// truncateSha
// ---------------------------------------------------------------------------

describe("truncateSha — commit SHA formatting", () => {
  it("returns em-dash for undefined", () => {
    expect(truncateSha(undefined)).toBe("—")
  })

  it("returns em-dash for empty string", () => {
    expect(truncateSha("")).toBe("—")
  })

  it("truncates a full 40-char SHA to 7 chars", () => {
    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    expect(truncateSha(sha)).toBe("a1b2c3d")
  })

  it("returns a short SHA as-is when already ≤ 7 chars", () => {
    expect(truncateSha("abc1234")).toBe("abc1234")
  })

  it("returns first 7 chars of exactly 7-char SHA", () => {
    expect(truncateSha("abc1234x")).toBe("abc1234")
  })
})

// ---------------------------------------------------------------------------
// buildQuickInfo
// ---------------------------------------------------------------------------

describe("buildQuickInfo — quick info extraction", () => {
  it("returns empty array when no branch, sha, or domain", () => {
    const app = makeApp()
    const rows = buildQuickInfo(app)
    expect(rows).toHaveLength(0)
  })

  it("includes branch row when app.branch is set", () => {
    const app = makeApp({ branch: "main" })
    const rows = buildQuickInfo(app)
    const branch = rows.find((r) => r.label === "Branch")
    expect(branch).toBeDefined()
    expect(branch?.value).toBe("main")
    expect(branch?.href).toBeUndefined()
  })

  it("includes commit row with truncated SHA", () => {
    const sha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const app = makeApp({ currentCommitSha: sha })
    const rows = buildQuickInfo(app)
    const commit = rows.find((r) => r.label === "Commit")
    expect(commit).toBeDefined()
    expect(commit?.value).toBe("deadbee")
    expect(commit?.title).toBe(sha)
  })

  it("includes domain row with https href when app.domain is set", () => {
    const app = makeApp({ domain: "my-app.ploydok.io" })
    const rows = buildQuickInfo(app)
    const domain = rows.find((r) => r.label === "Domain")
    expect(domain).toBeDefined()
    expect(domain?.value).toBe("my-app.ploydok.io")
    expect(domain?.href).toBe("https://my-app.ploydok.io")
  })

  it("returns rows in order: branch, commit, domain", () => {
    const app = makeApp({
      branch: "feat/x",
      currentCommitSha: "abc1234def5678901234567890123456789012",
      domain: "x.test",
    })
    const rows = buildQuickInfo(app)
    expect(rows.map((r) => r.label)).toEqual(["Branch", "Commit", "Domain"])
  })

  it("omits missing optional fields gracefully", () => {
    const app = makeApp({ branch: "main" })
    const rows = buildQuickInfo(app)
    const labels = rows.map((r) => r.label)
    expect(labels).not.toContain("Commit")
    expect(labels).not.toContain("Domain")
  })
})
