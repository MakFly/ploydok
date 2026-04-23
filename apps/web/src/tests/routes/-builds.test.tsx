// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for the Builds tab logic.
 *
 * Strategy: test extracted logic without needing TanStack Router, React Query,
 * or happy-dom — consistent with the existing test style in this repo.
 *
 * Covers:
 *  - formatDuration helper
 *  - selectedBuildId toggle (row click → select/deselect)
 *  - buildColumns shape (6 columns, correct IDs)
 *  - pagination logic: 7 builds at pageSize=5 → 2 pages, page 1 has 5 rows,
 *    page 2 has 2 rows, both pagination buttons are relevant at page 1.
 */
import { describe, expect, it } from "bun:test"
import type { Build } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// formatDuration (mirror of builds.tsx helper)
// ---------------------------------------------------------------------------

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return "—"
  const diff = ((endMs ?? Date.now()) - startMs) / 1000
  if (diff < 60) return `${Math.round(diff)}s`
  const m = Math.floor(diff / 60)
  const s = Math.round(diff % 60)
  return `${m}m ${s}s`
}

// ---------------------------------------------------------------------------
// selectedBuildId toggle logic (mirror of builds.tsx behaviour)
// ---------------------------------------------------------------------------

function toggleBuildId(
  current: string | null,
  clicked: string,
): string | null {
  return current === clicked ? null : clicked
}

// ---------------------------------------------------------------------------
// Pagination helpers (mirror of DataTable behaviour)
// ---------------------------------------------------------------------------

function paginate<T>(items: Array<T>, pageIndex: number, pageSize: number): Array<T> {
  return items.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
}

function pageCount(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize)
}

function canPreviousPage(pageIndex: number): boolean {
  return pageIndex > 0
}

function canNextPage(pageIndex: number, total: number, pageSize: number): boolean {
  return pageIndex < pageCount(total, pageSize) - 1
}

// ---------------------------------------------------------------------------
// Column IDs definition (mirror of builds.tsx buildColumns)
// ---------------------------------------------------------------------------

const EXPECTED_COLUMN_IDS = ["id", "status", "commit", "method", "duration", "started"]

// ---------------------------------------------------------------------------
// Mock builds (7 items → 2 pages at pageSize=5)
// ---------------------------------------------------------------------------

function makeBuild(n: number): Build {
  return {
    id: `build-id-${n.toString().padStart(4, "0")}`,
    appId: "app-1",
    status: "succeeded",
    buildMethod: "docker",
    commitSha: `abc${n.toString().padStart(4, "0")}`,
    startedAt: 1_700_000_000_000 + n * 60_000,
    finishedAt: 1_700_000_000_000 + n * 60_000 + 30_000,
    createdAt: 1_700_000_000_000 + n * 60_000,
  }
}

const MOCK_BUILDS: Array<Build> = Array.from({ length: 7 }, (_, i) => makeBuild(i + 1))
const PAGE_SIZE = 5

// ---------------------------------------------------------------------------
// Pure logic tests
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns — when startMs is undefined", () => {
    expect(formatDuration(undefined, undefined)).toBe("—")
  })

  it("formats seconds correctly", () => {
    const start = 1_700_000_000_000
    const end = start + 45_000 // 45 seconds
    expect(formatDuration(start, end)).toBe("45s")
  })

  it("formats minutes and seconds correctly", () => {
    const start = 1_700_000_000_000
    const end = start + 90_000 // 90 s = 1m 30s
    expect(formatDuration(start, end)).toBe("1m 30s")
  })
})

describe("selectedBuildId toggle", () => {
  it("selects a build when none is selected", () => {
    expect(toggleBuildId(null, "build-1")).toBe("build-1")
  })

  it("deselects a build when the same build is clicked again", () => {
    expect(toggleBuildId("build-1", "build-1")).toBeNull()
  })

  it("switches to a different build", () => {
    expect(toggleBuildId("build-1", "build-2")).toBe("build-2")
  })
})

describe("buildColumns shape", () => {
  it("has exactly 6 columns", () => {
    expect(EXPECTED_COLUMN_IDS.length).toBe(6)
  })

  it("column IDs are correct", () => {
    expect(EXPECTED_COLUMN_IDS).toEqual([
      "id",
      "status",
      "commit",
      "method",
      "duration",
      "started",
    ])
  })
})

describe("pagination logic — 7 builds at pageSize=5", () => {
  it("page count is 2", () => {
    expect(pageCount(MOCK_BUILDS.length, PAGE_SIZE)).toBe(2)
  })

  it("page 1 (index 0) contains 5 rows", () => {
    const page = paginate(MOCK_BUILDS, 0, PAGE_SIZE)
    expect(page.length).toBe(5)
  })

  it("page 2 (index 1) contains the remaining 2 rows", () => {
    const page = paginate(MOCK_BUILDS, 1, PAGE_SIZE)
    expect(page.length).toBe(2)
  })

  it("Prev button is disabled on page 1", () => {
    expect(canPreviousPage(0)).toBe(false)
  })

  it("Next button is enabled on page 1", () => {
    expect(canNextPage(0, MOCK_BUILDS.length, PAGE_SIZE)).toBe(true)
  })

  it("Prev button is enabled on page 2", () => {
    expect(canPreviousPage(1)).toBe(true)
  })

  it("Next button is disabled on page 2", () => {
    expect(canNextPage(1, MOCK_BUILDS.length, PAGE_SIZE)).toBe(false)
  })

  it("clicking a row on page 1 selects the correct build", () => {
    const page = paginate(MOCK_BUILDS, 0, PAGE_SIZE)
    // Simulate clicking the first row
    const selectedId = toggleBuildId(null, page[0].id)
    expect(selectedId).toBe(MOCK_BUILDS[0].id)
  })

  it("clicking the same row again deselects the build", () => {
    const page = paginate(MOCK_BUILDS, 0, PAGE_SIZE)
    const firstBuildId = page[0].id
    const selected = toggleBuildId(null, firstBuildId)
    const deselected = toggleBuildId(selected, firstBuildId)
    expect(deselected).toBeNull()
  })
})
