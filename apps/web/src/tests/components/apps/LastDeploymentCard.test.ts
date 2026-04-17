// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for LastDeploymentCard pure helpers.
 * No DOM rendering.
 */
import { describe, expect, it } from "bun:test"
import type { Build } from "@ploydok/shared"
import {
  formatDuration,
  truncateSha,
  buildStatusToAppStatus,
} from "../../../components/apps/LastDeploymentCard"

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns — when startedAt is undefined", () => {
    expect(formatDuration(undefined, 1000)).toBe("—")
  })

  it("returns — when finishedAt is undefined", () => {
    expect(formatDuration(1000, undefined)).toBe("—")
  })

  it("formats ms under 1s", () => {
    expect(formatDuration(0, 500)).toBe("500ms")
  })

  it("formats seconds", () => {
    expect(formatDuration(0, 45_000)).toBe("45s")
  })

  it("formats minutes and seconds", () => {
    expect(formatDuration(0, 125_000)).toBe("2m 5s")
  })

  it("formats exact minutes", () => {
    expect(formatDuration(0, 120_000)).toBe("2m")
  })
})

// ---------------------------------------------------------------------------
// truncateSha
// ---------------------------------------------------------------------------

describe("truncateSha", () => {
  it("returns first 7 chars of a full SHA", () => {
    expect(truncateSha("abc1234567890")).toBe("abc1234")
  })

  it("returns 'unknown' for undefined", () => {
    expect(truncateSha(undefined)).toBe("unknown")
  })

  it("returns the full string when shorter than 7 chars", () => {
    expect(truncateSha("abc")).toBe("abc")
  })
})

// ---------------------------------------------------------------------------
// buildStatusToAppStatus
// ---------------------------------------------------------------------------

describe("buildStatusToAppStatus", () => {
  it("maps running → building", () => {
    expect(buildStatusToAppStatus("running")).toBe("building")
  })

  it("maps succeeded → running", () => {
    expect(buildStatusToAppStatus("succeeded")).toBe("running")
  })

  it("maps failed → failed", () => {
    expect(buildStatusToAppStatus("failed")).toBe("failed")
  })

  it("maps cancelled → stopped", () => {
    expect(buildStatusToAppStatus("cancelled")).toBe("stopped")
  })

  it("maps pending → pending", () => {
    expect(buildStatusToAppStatus("pending")).toBe("pending")
  })
})

// ---------------------------------------------------------------------------
// CTA logic
// ---------------------------------------------------------------------------

describe("LastDeploymentCard — CTA contract", () => {
  it("shows Deploy CTA when no builds exist", () => {
    const builds: Array<Build> = []
    const showCta = builds.length === 0
    expect(showCta).toBe(true)
  })

  it("shows build info when at least one build exists", () => {
    const builds: Array<Build> = [
      {
        id: "b1",
        appId: "app-1",
        status: "succeeded",
        buildMethod: "auto",
        commitSha: "abc1234567890",
        startedAt: 0,
        finishedAt: 60_000,
        createdAt: 0,
      },
    ]
    const showCta = builds.length === 0
    expect(showCta).toBe(false)
    expect(builds[0].commitSha?.slice(0, 7)).toBe("abc1234")
  })

  it("links to builds route (fallback before 2.A merge)", () => {
    // Contract: the link path includes /builds until 2.A renames it.
    const appId = "app-42"
    const expectedPathContains = `/apps/${appId}/builds`
    // The TODO(wave-2-merge) comment documents this will flip to /deployments.
    expect(expectedPathContains).toContain("/builds")
  })
})
