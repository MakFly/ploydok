// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for CommandPalette — pure logic (filter + navigation path construction).
 * No React rendering, no DOM, no router needed.
 */
import { describe, expect, it } from "bun:test"
import {

  matchesQuery
} from "../../../components/layout/CommandPalette"
import type {FilterableItem} from "../../../components/layout/CommandPalette";

// ---------------------------------------------------------------------------
// matchesQuery — case-insensitive filter
// ---------------------------------------------------------------------------

describe("matchesQuery", () => {
  const item: FilterableItem = { id: "app-1", label: "my-cool-app" }

  it("returns true for empty query (show all)", () => {
    expect(matchesQuery(item, "")).toBe(true)
  })

  it("returns true for whitespace-only query (show all)", () => {
    expect(matchesQuery(item, "   ")).toBe(true)
  })

  it("matches exact label", () => {
    expect(matchesQuery(item, "my-cool-app")).toBe(true)
  })

  it("matches substring (start)", () => {
    expect(matchesQuery(item, "my-cool")).toBe(true)
  })

  it("matches substring (middle)", () => {
    expect(matchesQuery(item, "cool")).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(matchesQuery(item, "MY-COOL")).toBe(true)
    expect(matchesQuery(item, "My-Cool-App")).toBe(true)
  })

  it("returns false when query does not match", () => {
    expect(matchesQuery(item, "postgres")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Navigation path construction — pure helper
// ---------------------------------------------------------------------------

describe("navigation path construction", () => {
  function buildAppPath(appId: string): string {
    return `/apps/${appId}/settings`
  }

  function buildLogsPath(appId: string): string {
    return `/apps/${appId}/logs`
  }

  it("constructs correct landing path for an app", () => {
    expect(buildAppPath("abc123")).toBe("/apps/abc123/settings")
  })

  it("constructs correct logs path for an app", () => {
    expect(buildLogsPath("abc123")).toBe("/apps/abc123/logs")
  })

  it("handles UUID-style ids", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
    expect(buildAppPath(id)).toBe(`/apps/${id}/settings`)
  })
})

// ---------------------------------------------------------------------------
// App list filtering — simulate what cmdk does per group
// ---------------------------------------------------------------------------

describe("app list filtering via matchesQuery", () => {
  const apps: Array<FilterableItem> = [
    { id: "1", label: "frontend-app" },
    { id: "2", label: "backend-api" },
    { id: "3", label: "postgres-db" },
    { id: "4", label: "Frontend Admin" },
  ]

  it("returns all apps for empty query", () => {
    const result = apps.filter((a) => matchesQuery(a, ""))
    expect(result).toHaveLength(4)
  })

  it("filters to matching apps (case-insensitive)", () => {
    const result = apps.filter((a) => matchesQuery(a, "frontend"))
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.id)).toEqual(["1", "4"])
  })

  it("filters to single app", () => {
    const result = apps.filter((a) => matchesQuery(a, "postgres"))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("3")
  })

  it("returns empty array when no match", () => {
    const result = apps.filter((a) => matchesQuery(a, "redis"))
    expect(result).toHaveLength(0)
  })
})
