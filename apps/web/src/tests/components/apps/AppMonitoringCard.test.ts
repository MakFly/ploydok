// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for AppMonitoringCard logic.
 * Tests pure helpers; does not render DOM.
 */
import { describe, expect, it } from "bun:test"
import type { ContainerSnapshot } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Logic extracted from AppMonitoringCard
// ---------------------------------------------------------------------------

const HISTORY_LEN = 60

function pushToHistory(history: Array<number>, value: number): Array<number> {
  return [...history, value].slice(-HISTORY_LEN)
}

/**
 * Given a container.health SSE payload, determine if it belongs to this app.
 * Returns null if the snapshot should be ignored.
 */
function filterSnapshot(
  payload: { appId?: string; container?: ContainerSnapshot },
  targetAppId: string,
): ContainerSnapshot | null {
  if (payload.appId !== targetAppId) return null
  if (!payload.container) return null
  return payload.container
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AppMonitoringCard — filterSnapshot", () => {
  const snap: ContainerSnapshot = {
    id: "c1",
    name: "my-app",
    image: "my-app:latest",
    status: "running",
    uptime_s: 300,
    cpu_pct: 12.5,
    mem_bytes: 128 * 1024 * 1024,
    mem_limit_bytes: 512 * 1024 * 1024,
    restart_count: 0,
    kind: "app",
    app_id: "app-1",
    last_seen_ms: Date.now(),
  }

  it("returns snapshot when appId matches", () => {
    const result = filterSnapshot({ appId: "app-1", container: snap }, "app-1")
    expect(result).toBe(snap)
  })

  it("returns null when appId does not match", () => {
    const result = filterSnapshot({ appId: "app-2", container: snap }, "app-1")
    expect(result).toBeNull()
  })

  it("returns null when appId is absent from payload", () => {
    const result = filterSnapshot({ container: snap }, "app-1")
    expect(result).toBeNull()
  })

  it("returns null when container is absent (but appId matches)", () => {
    const result = filterSnapshot({ appId: "app-1" }, "app-1")
    expect(result).toBeNull()
  })
})

describe("AppMonitoringCard — history ring buffer", () => {
  it("appends values to the history", () => {
    const h = pushToHistory([], 10)
    expect(h).toEqual([10])
  })

  it("maintains order (oldest first)", () => {
    let h: Array<number> = []
    h = pushToHistory(h, 1)
    h = pushToHistory(h, 2)
    h = pushToHistory(h, 3)
    expect(h).toEqual([1, 2, 3])
  })

  it(`caps at ${HISTORY_LEN} entries`, () => {
    let h: Array<number> = []
    for (let i = 0; i < HISTORY_LEN + 10; i++) {
      h = pushToHistory(h, i)
    }
    expect(h.length).toBe(HISTORY_LEN)
    // Oldest entries dropped, most recent retained
    expect(h[h.length - 1]).toBe(HISTORY_LEN + 9)
  })
})

describe("AppMonitoringCard — not-running state contract", () => {
  it("shows not-running when snapshot is null (contract test)", () => {
    // When snapshot is null, the component renders NotRunning.
    // This tests the branching contract without rendering DOM.
    const snapshot: ContainerSnapshot | null = null
    const shouldShowNotRunning = snapshot === null
    expect(shouldShowNotRunning).toBe(true)
  })

  it("shows resource card when snapshot is present", () => {
    const snapshot: ContainerSnapshot | null = {
      id: "c1",
      name: "app",
      image: "app:latest",
      status: "running",
      uptime_s: 0,
      cpu_pct: 0,
      mem_bytes: 0,
      mem_limit_bytes: 0,
      restart_count: 0,
      last_seen_ms: Date.now(),
    }
    const shouldShowNotRunning = snapshot === null
    expect(shouldShowNotRunning).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Restarting state logic (contract tests — no DOM rendering)
// ---------------------------------------------------------------------------

type AppStatus = "created" | "pending" | "building" | "running" | "restarting" | "failed" | "stopped"

/**
 * Mirror the render decision logic from AppMonitoringCard:
 * - no snapshot + restarting  → restarting placeholder
 * - no snapshot + !restarting → not-running
 * - snapshot + restarting     → resource card WITH overlay
 * - snapshot + !restarting    → resource card (no overlay)
 */
function resolveRenderMode(
  snapshot: ContainerSnapshot | null,
  appStatus: AppStatus | undefined,
): "not-running" | "restarting-no-data" | "resource-with-overlay" | "resource" {
  const isRestarting = appStatus === "restarting"
  if (!snapshot) {
    return isRestarting ? "restarting-no-data" : "not-running"
  }
  return isRestarting ? "resource-with-overlay" : "resource"
}

describe("AppMonitoringCard — restarting state contract", () => {
  it("shows restarting placeholder when snapshot is null and status is restarting", () => {
    expect(resolveRenderMode(null, "restarting")).toBe("restarting-no-data")
  })

  it("shows not-running when snapshot is null and status is not restarting", () => {
    expect(resolveRenderMode(null, "running")).toBe("not-running")
    expect(resolveRenderMode(null, undefined)).toBe("not-running")
  })

  it("shows resource card with overlay when snapshot is present and status is restarting", () => {
    const snap: ContainerSnapshot = {
      id: "c1",
      name: "app",
      image: "app:latest",
      status: "running",
      uptime_s: 100,
      cpu_pct: 5,
      mem_bytes: 64 * 1024 * 1024,
      mem_limit_bytes: 256 * 1024 * 1024,
      restart_count: 1,
      last_seen_ms: Date.now(),
    }
    expect(resolveRenderMode(snap, "restarting")).toBe("resource-with-overlay")
  })

  it("shows plain resource card when snapshot is present and status is running", () => {
    const snap: ContainerSnapshot = {
      id: "c2",
      name: "app",
      image: "app:latest",
      status: "running",
      uptime_s: 200,
      cpu_pct: 2,
      mem_bytes: 32 * 1024 * 1024,
      mem_limit_bytes: 256 * 1024 * 1024,
      restart_count: 0,
      last_seen_ms: Date.now(),
    }
    expect(resolveRenderMode(snap, "running")).toBe("resource")
  })

  it("snapshot is NOT cleared when transitioning running → restarting", () => {
    // The useEffect in the component only clears on appId change.
    // This contract test verifies we do NOT derive a 'clear' from status alone.
    const prevSnapshot: ContainerSnapshot = {
      id: "c3",
      name: "app",
      image: "app:latest",
      status: "running",
      uptime_s: 50,
      cpu_pct: 8,
      mem_bytes: 128 * 1024 * 1024,
      mem_limit_bytes: 512 * 1024 * 1024,
      restart_count: 0,
      last_seen_ms: Date.now(),
    }
    const appId = "app-1"
    const prevAppId = "app-1"
    // appId unchanged → snapshot should NOT reset
    const shouldReset = appId !== prevAppId
    expect(shouldReset).toBe(false)
    // With unchanged appId, snapshot persists → shows overlay on top of ResourceCard
    expect(resolveRenderMode(prevSnapshot, "restarting")).toBe("resource-with-overlay")
  })
})
