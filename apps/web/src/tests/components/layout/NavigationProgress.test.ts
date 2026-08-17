// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for NavigationProgress.tsx — the pure phase and progress logic.
 */
import { describe, expect, it } from "bun:test"
import {
  nextPhase,
  tickProgress,
} from "../../../components/layout/NavigationProgress"

describe("nextPhase", () => {
  it("arms the delay when a navigation starts", () => {
    expect(nextPhase("idle", true)).toBe("appearing")
  })

  it("stays armed while the delay has not elapsed", () => {
    expect(nextPhase("appearing", true)).toBe("appearing")
  })

  it("drops back to idle when the navigation beats the delay", () => {
    expect(nextPhase("appearing", false)).toBe("idle")
  })

  it("keeps growing while the router is still loading", () => {
    expect(nextPhase("growing", true)).toBe("growing")
  })

  it("completes once the router settles", () => {
    expect(nextPhase("growing", false)).toBe("done")
  })

  it("stays done until the fade-out timer resets it", () => {
    expect(nextPhase("done", false)).toBe("done")
  })

  it("does not restart from done while a new navigation is running", () => {
    expect(nextPhase("done", true)).toBe("done")
  })
})

describe("tickProgress", () => {
  it("increases monotonically below the ceiling", () => {
    const first = tickProgress(20)
    expect(first).toBeGreaterThan(20)
    expect(tickProgress(first)).toBeGreaterThan(first)
  })

  it("converges toward the ceiling without ever reaching it", () => {
    let progress = 20
    for (let i = 0; i < 200; i += 1) progress = tickProgress(progress)

    expect(progress).toBeLessThan(92)
    expect(progress).toBeGreaterThan(90)
  })
})
