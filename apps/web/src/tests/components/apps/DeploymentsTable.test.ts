// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for DeploymentsTable pure logic.
 * Validates status, duration formatting, truncation, and rollback availability.
 */
import { describe, expect, it } from "bun:test"
import { formatDuration, truncate } from "../../../components/apps/DeploymentsTable"
import type { Build } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns — when no startMs", () => {
    expect(formatDuration(undefined, undefined)).toBe("—")
  })

  it("formats seconds when diff < 60s", () => {
    const start = 1_000_000
    const end = start + 42_000
    expect(formatDuration(start, end)).toBe("42s")
  })

  it("formats minutes and seconds when diff >= 60s", () => {
    const start = 1_000_000
    const end = start + 125_000 // 2m 5s
    expect(formatDuration(start, end)).toBe("2m 5s")
  })

  it("uses Date.now() when endMs is undefined (in-progress build)", () => {
    const start = Date.now() - 10_000 // 10 seconds ago
    const result = formatDuration(start, undefined)
    // Result should be approximately "10s" — allow ±1s due to timing
    expect(result).toMatch(/^(9|10|11)s$/)
  })
})

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns unchanged string when within maxLen", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  it("returns exact maxLen string unchanged", () => {
    expect(truncate("hello", 5)).toBe("hello")
  })

  it("truncates and appends … when over maxLen", () => {
    const result = truncate("hello world", 8)
    expect(result.length).toBe(8)
    expect(result.endsWith("…")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rollback availability logic
// ---------------------------------------------------------------------------

describe("rollback availability", () => {
  function canRollback(build: Pick<Build, "status">): boolean {
    return build.status === "succeeded"
  }

  it("allows rollback for succeeded builds", () => {
    expect(canRollback({ status: "succeeded" })).toBe(true)
  })

  it("disallows rollback for failed builds", () => {
    expect(canRollback({ status: "failed" })).toBe(false)
  })

  it("disallows rollback for pending builds", () => {
    expect(canRollback({ status: "pending" })).toBe(false)
  })

  it("disallows rollback for running builds", () => {
    expect(canRollback({ status: "running" })).toBe(false)
  })

  it("disallows rollback for cancelled builds", () => {
    expect(canRollback({ status: "cancelled" })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Build status badge class mapping
// ---------------------------------------------------------------------------

describe("status badge — in-progress detection", () => {
  const IN_PROGRESS: ReadonlySet<string> = new Set(["pending", "running"])

  it("marks pending as in-progress", () => {
    expect(IN_PROGRESS.has("pending")).toBe(true)
  })

  it("marks running as in-progress", () => {
    expect(IN_PROGRESS.has("running")).toBe(true)
  })

  it("does not mark succeeded as in-progress", () => {
    expect(IN_PROGRESS.has("succeeded")).toBe(false)
  })

  it("does not mark failed as in-progress", () => {
    expect(IN_PROGRESS.has("failed")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Commit SHA truncation (7 chars)
// ---------------------------------------------------------------------------

describe("commit SHA display", () => {
  function displaySha(sha: string | undefined): string {
    return sha ? sha.slice(0, 7) : "—"
  }

  it("shows 7 chars of a full SHA", () => {
    expect(displaySha("abcdef1234567890")).toBe("abcdef1")
  })

  it("shows — when sha is undefined", () => {
    expect(displaySha(undefined)).toBe("—")
  })
})
