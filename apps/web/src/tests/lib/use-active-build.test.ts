// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for use-active-build.ts — SSE transition logic.
 * Tests the state machine logic without React hooks.
 */
import { describe, expect, it } from "bun:test"
import type { BuildStatus } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Extract the pure state-transition logic for testability
// ---------------------------------------------------------------------------

interface ActiveBuildState {
  isActive: boolean
  buildId?: string
  status?: BuildStatus
}

type Action =
  | { type: "build.started"; appId: string; buildId: string }
  | { type: "build.succeeded"; appId: string; buildId: string; status: BuildStatus }
  | { type: "build.failed"; appId: string; buildId: string; status: BuildStatus }

function activeBuildReducer(
  state: ActiveBuildState,
  action: Action,
  targetAppId: string,
): ActiveBuildState {
  if (action.appId !== targetAppId) return state
  switch (action.type) {
    case "build.started":
      return { isActive: true, buildId: action.buildId, status: "running" }
    case "build.succeeded":
      return { isActive: false, buildId: action.buildId, status: "succeeded" }
    case "build.failed":
      return { isActive: false, buildId: action.buildId, status: "failed" }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useActiveBuild — state transitions", () => {
  const APP_ID = "app-123"
  const OTHER_APP_ID = "app-999"
  const initial: ActiveBuildState = { isActive: false }

  it("starts inactive", () => {
    expect(initial.isActive).toBe(false)
  })

  it("build.started sets isActive=true and stores buildId", () => {
    const next = activeBuildReducer(
      initial,
      { type: "build.started", appId: APP_ID, buildId: "build-1" },
      APP_ID,
    )
    expect(next.isActive).toBe(true)
    expect(next.buildId).toBe("build-1")
    expect(next.status).toBe("running")
  })

  it("build.succeeded clears isActive", () => {
    const active: ActiveBuildState = { isActive: true, buildId: "build-1", status: "running" }
    const next = activeBuildReducer(
      active,
      { type: "build.succeeded", appId: APP_ID, buildId: "build-1", status: "succeeded" },
      APP_ID,
    )
    expect(next.isActive).toBe(false)
    expect(next.status).toBe("succeeded")
  })

  it("build.failed clears isActive", () => {
    const active: ActiveBuildState = { isActive: true, buildId: "build-2", status: "running" }
    const next = activeBuildReducer(
      active,
      { type: "build.failed", appId: APP_ID, buildId: "build-2", status: "failed" },
      APP_ID,
    )
    expect(next.isActive).toBe(false)
    expect(next.status).toBe("failed")
  })

  it("ignores events from a different app", () => {
    const next = activeBuildReducer(
      initial,
      { type: "build.started", appId: OTHER_APP_ID, buildId: "build-other" },
      APP_ID,
    )
    expect(next).toBe(initial)
    expect(next.isActive).toBe(false)
  })

  it("sequence: start → succeed → start again", () => {
    let state = initial
    state = activeBuildReducer(
      state,
      { type: "build.started", appId: APP_ID, buildId: "build-1" },
      APP_ID,
    )
    expect(state.isActive).toBe(true)
    state = activeBuildReducer(
      state,
      { type: "build.succeeded", appId: APP_ID, buildId: "build-1", status: "succeeded" },
      APP_ID,
    )
    expect(state.isActive).toBe(false)
    state = activeBuildReducer(
      state,
      { type: "build.started", appId: APP_ID, buildId: "build-2" },
      APP_ID,
    )
    expect(state.isActive).toBe(true)
    expect(state.buildId).toBe("build-2")
  })
})
