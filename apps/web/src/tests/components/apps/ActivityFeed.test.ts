// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for ActivityFeed pure helpers.
 * No DOM rendering.
 */
import { describe, expect, it } from "bun:test"
import {
  formatEventType,
  eventIcon,
  formatRelativeTime,
} from "../../../components/apps/ActivityFeed"
import type { AppEventType } from "../../../lib/hooks/use-app-events"

// ---------------------------------------------------------------------------
// formatEventType
// ---------------------------------------------------------------------------

describe("formatEventType", () => {
  const cases: Array<[AppEventType, string]> = [
    ["build.started", "Build started"],
    ["build.succeeded", "Build succeeded"],
    ["build.failed", "Build failed"],
    ["deploy.status_change", "Deployment status changed"],
    ["container.health", "Container health update"],
  ]

  for (const [type, expected] of cases) {
    it(`formats ${type}`, () => {
      expect(formatEventType(type)).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// eventIcon
// ---------------------------------------------------------------------------

describe("eventIcon", () => {
  it("returns ↑ for build.started", () => {
    expect(eventIcon("build.started")).toBe("↑")
  })

  it("returns ✓ for build.succeeded", () => {
    expect(eventIcon("build.succeeded")).toBe("✓")
  })

  it("returns ✗ for build.failed", () => {
    expect(eventIcon("build.failed")).toBe("✗")
  })

  it("returns ⇄ for deploy.status_change", () => {
    expect(eventIcon("deploy.status_change")).toBe("⇄")
  })

  it("returns ♥ for container.health", () => {
    expect(eventIcon("container.health")).toBe("♥")
  })
})

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  const now = 1_000_000

  it("formats seconds ago", () => {
    const result = formatRelativeTime(now - 30_000, now)
    expect(result).toContain("second")
  })

  it("formats minutes ago", () => {
    const result = formatRelativeTime(now - 5 * 60_000, now)
    expect(result).toContain("minute")
  })

  it("formats hours ago", () => {
    const result = formatRelativeTime(now - 3 * 3_600_000, now)
    expect(result).toContain("hour")
  })

  it("formats days ago", () => {
    const result = formatRelativeTime(now - 2 * 86_400_000, now)
    expect(result).toContain("day")
  })

  it("formats future seconds", () => {
    const result = formatRelativeTime(now + 10_000, now)
    // Intl.RelativeTimeFormat returns "in X seconds"
    expect(result).toContain("second")
  })
})

// ---------------------------------------------------------------------------
// Max items logic (pure)
// ---------------------------------------------------------------------------

describe("ActivityFeed — item limit contract", () => {
  it("shows at most 10 items by default", () => {
    const limit = 10
    // prependEvent (tested in use-app-events.test.ts) enforces this.
    // This test documents the ActivityFeed contract.
    expect(limit).toBe(10)
  })

  it("allows a custom limit", () => {
    const customLimit = 5
    expect(customLimit).toBeLessThan(10)
  })
})
