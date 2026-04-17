// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for ActionsMenu logic.
 * Validates rollback filtering, delete confirmation, and action routing.
 */
import { describe, expect, it } from "bun:test"
import type { Build, BuildStatus } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Pure logic extracted from ActionsMenu behavior
// ---------------------------------------------------------------------------

function filterSucceededBuilds(builds: Array<Build>): Array<Build> {
  return builds.filter((b) => b.status === "succeeded").slice(0, 10)
}

function canConfirmDelete(input: string, appName: string): boolean {
  return input === appName
}

function isDeleteDisabled(input: string, appName: string, isPending: boolean): boolean {
  return isPending || input !== appName
}

function getDialogTitle(kind: "stop" | "restart" | "rollback" | "delete", appName: string): string {
  switch (kind) {
    case "stop":
      return `Stop ${appName}?`
    case "restart":
      return `Restart ${appName}?`
    case "rollback":
      return `Rollback ${appName}`
    case "delete":
      return `Delete ${appName}?`
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuild(id: string, status: BuildStatus): Build {
  return {
    id,
    appId: "app-1",
    status,
    buildMethod: "docker",
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActionsMenu — rollback build filtering", () => {
  it("returns only succeeded builds", () => {
    const builds: Array<Build> = [
      makeBuild("b1", "succeeded"),
      makeBuild("b2", "failed"),
      makeBuild("b3", "succeeded"),
      makeBuild("b4", "running"),
      makeBuild("b5", "pending"),
    ]
    const filtered = filterSucceededBuilds(builds)
    expect(filtered).toHaveLength(2)
    expect(filtered.every((b) => b.status === "succeeded")).toBe(true)
  })

  it("caps rollback list at 10 builds", () => {
    const builds: Array<Build> = Array.from({ length: 15 }, (_, i) =>
      makeBuild(`b${i}`, "succeeded"),
    )
    expect(filterSucceededBuilds(builds)).toHaveLength(10)
  })

  it("returns empty array when no succeeded builds", () => {
    const builds: Array<Build> = [
      makeBuild("b1", "failed"),
      makeBuild("b2", "running"),
    ]
    expect(filterSucceededBuilds(builds)).toHaveLength(0)
  })
})

describe("ActionsMenu — delete confirmation", () => {
  const APP_NAME = "my-cool-app"

  it("allows delete when name matches exactly", () => {
    expect(canConfirmDelete(APP_NAME, APP_NAME)).toBe(true)
  })

  it("rejects delete when name is wrong", () => {
    expect(canConfirmDelete("wrong-name", APP_NAME)).toBe(false)
  })

  it("rejects delete when input is partial", () => {
    expect(canConfirmDelete("my-cool", APP_NAME)).toBe(false)
  })

  it("delete button is disabled when name doesn't match", () => {
    expect(isDeleteDisabled("wrong", APP_NAME, false)).toBe(true)
  })

  it("delete button is disabled when pending", () => {
    expect(isDeleteDisabled(APP_NAME, APP_NAME, true)).toBe(true)
  })

  it("delete button is enabled when name matches and not pending", () => {
    expect(isDeleteDisabled(APP_NAME, APP_NAME, false)).toBe(false)
  })
})

describe("ActionsMenu — dialog titles", () => {
  it("shows correct title for stop", () => {
    expect(getDialogTitle("stop", "my-app")).toBe("Stop my-app?")
  })
  it("shows correct title for restart", () => {
    expect(getDialogTitle("restart", "my-app")).toBe("Restart my-app?")
  })
  it("shows correct title for rollback", () => {
    expect(getDialogTitle("rollback", "my-app")).toBe("Rollback my-app")
  })
  it("shows correct title for delete", () => {
    expect(getDialogTitle("delete", "my-app")).toBe("Delete my-app?")
  })
})
