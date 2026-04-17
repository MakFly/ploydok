// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for BuildLogDrawer pure logic.
 * Validates drawer open/close state, title formatting, and download URL construction.
 */
import { describe, expect, it } from "bun:test"

// ---------------------------------------------------------------------------
// Drawer state logic
// ---------------------------------------------------------------------------

describe("BuildLogDrawer — open/close state", () => {
  function isDrawerOpen(buildId: string | undefined): boolean {
    return Boolean(buildId)
  }

  it("is open when buildId is a non-empty string", () => {
    expect(isDrawerOpen("build-abc123")).toBe(true)
  })

  it("is closed when buildId is undefined", () => {
    expect(isDrawerOpen(undefined)).toBe(false)
  })

  it("is closed when buildId is empty string", () => {
    expect(isDrawerOpen("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Title formatting
// ---------------------------------------------------------------------------

describe("BuildLogDrawer — title", () => {
  function drawerTitle(buildId: string | undefined): string {
    return buildId ? `Build logs — ${buildId.slice(0, 8)}` : "Build logs"
  }

  it("shows truncated buildId when present", () => {
    expect(drawerTitle("abcdefghijklmnop")).toBe("Build logs — abcdefgh")
  })

  it("shows generic title when buildId is undefined", () => {
    expect(drawerTitle(undefined)).toBe("Build logs")
  })

  it("handles short buildIds without truncating", () => {
    expect(drawerTitle("abc")).toBe("Build logs — abc")
  })
})

// ---------------------------------------------------------------------------
// Download URL construction
// ---------------------------------------------------------------------------

describe("BuildLogDrawer — download URL", () => {
  function buildDownloadUrl(appId: string, buildId: string): string {
    return `/api/apps/${appId}/logs?buildId=${encodeURIComponent(buildId)}`
  }

  it("constructs the correct download URL", () => {
    expect(buildDownloadUrl("app-123", "build-456")).toBe(
      "/api/apps/app-123/logs?buildId=build-456",
    )
  })

  it("URL-encodes the buildId", () => {
    const result = buildDownloadUrl("app-1", "build/with/slashes")
    expect(result).toBe("/api/apps/app-1/logs?buildId=build%2Fwith%2Fslashes")
  })
})

// ---------------------------------------------------------------------------
// Download filename
// ---------------------------------------------------------------------------

describe("BuildLogDrawer — download filename", () => {
  function downloadFilename(buildId: string): string {
    return `build-${buildId.slice(0, 8)}.log`
  }

  it("uses first 8 chars of buildId as filename", () => {
    expect(downloadFilename("abcdefghijklmnop")).toBe("build-abcdefgh.log")
  })

  it("handles short buildIds", () => {
    expect(downloadFilename("abc")).toBe("build-abc.log")
  })
})
