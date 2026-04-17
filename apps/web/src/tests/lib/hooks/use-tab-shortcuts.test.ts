// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for use-tab-shortcuts.ts — pure state machine logic.
 * No DOM, no React, no router needed.
 */
import { describe, expect, it } from "bun:test"
import { SHORTCUT_MAP, TIMEOUT_MS, nextState } from "../../../lib/hooks/use-tab-shortcuts"
import type { ShortcutAction, ShortcutState, TabSegment } from "../../../lib/hooks/use-tab-shortcuts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const idle: ShortcutState = { phase: "idle" }
const T0 = 1_000_000 // arbitrary stable timestamp

function keyAction(
  key: string,
  opts: { modKey?: boolean; ignored?: boolean; now?: number } = {},
): ShortcutAction {
  return {
    type: "key",
    key,
    modKey: opts.modKey ?? false,
    ignored: opts.ignored ?? false,
    now: opts.now ?? T0,
  }
}

function tickAction(now: number): ShortcutAction {
  return { type: "tick", now }
}

function awaiting(startedAt: number): ShortcutState {
  return { phase: "awaiting", startedAt }
}

// ---------------------------------------------------------------------------
// idle → awaiting
// ---------------------------------------------------------------------------

describe("idle phase", () => {
  it("pressing g transitions to awaiting", () => {
    const result = nextState(idle, keyAction("g", { now: T0 }))
    expect(result.state).toEqual({ phase: "awaiting", startedAt: T0 })
    expect(result.navigateTo).toBeUndefined()
  })

  it("pressing any other key stays idle", () => {
    for (const key of ["o", "d", "l", "s", "e", "n", "x", "a"]) {
      const result = nextState(idle, keyAction(key, { now: T0 }))
      expect(result.state).toEqual({ phase: "idle" })
      expect(result.navigateTo).toBeUndefined()
    }
  })

  it("pressing g with modifier key does NOT transition (resets to idle)", () => {
    const result = nextState(idle, keyAction("g", { modKey: true, now: T0 }))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBeUndefined()
  })

  it("ignored events are no-ops", () => {
    const result = nextState(idle, keyAction("g", { ignored: true, now: T0 }))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBeUndefined()
  })

  it("tick in idle is a no-op", () => {
    const result = nextState(idle, tickAction(T0 + TIMEOUT_MS + 1))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// awaiting → navigate
// ---------------------------------------------------------------------------

describe("awaiting phase — navigation", () => {
  it("pressing o navigates to overview", () => {
    const result = nextState(awaiting(T0), keyAction("o", { now: T0 + 300 }))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBe(SHORTCUT_MAP["o"])
  })

  it("pressing d navigates to deployments", () => {
    const result = nextState(awaiting(T0), keyAction("d", { now: T0 + 300 }))
    expect(result.navigateTo).toBe(SHORTCUT_MAP["d"])
  })

  it("pressing l navigates to logs", () => {
    const result = nextState(awaiting(T0), keyAction("l", { now: T0 + 300 }))
    expect(result.navigateTo).toBe(SHORTCUT_MAP["l"])
  })

  it("pressing s navigates to settings", () => {
    const result = nextState(awaiting(T0), keyAction("s", { now: T0 + 300 }))
    expect(result.navigateTo).toBe(SHORTCUT_MAP["s"])
  })

  it("pressing e navigates to env", () => {
    const result = nextState(awaiting(T0), keyAction("e", { now: T0 + 300 }))
    expect(result.navigateTo).toBe(SHORTCUT_MAP["e"])
  })

  it("pressing n navigates to domains", () => {
    const result = nextState(awaiting(T0), keyAction("n", { now: T0 + 300 }))
    expect(result.navigateTo).toBe(SHORTCUT_MAP["n"])
  })

  it("all SHORTCUT_MAP values are valid TabSegments", () => {
    const validSegments: ReadonlyArray<TabSegment> = [
      "overview",
      "deployments",
      "logs",
      "settings",
      "env",
      "domains",
    ]
    for (const [, segment] of Object.entries(SHORTCUT_MAP)) {
      if (segment !== undefined) {
        expect(validSegments).toContain(segment)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// awaiting → idle (cancel conditions)
// ---------------------------------------------------------------------------

describe("awaiting phase — cancellation", () => {
  it("pressing an unmapped key cancels and returns idle", () => {
    const result = nextState(awaiting(T0), keyAction("x", { now: T0 + 300 }))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBeUndefined()
  })

  it("pressing modifier key cancels", () => {
    const result = nextState(awaiting(T0), keyAction("o", { modKey: true, now: T0 + 300 }))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBeUndefined()
  })

  it("ignored event (input focused) is no-op — stays in awaiting", () => {
    const result = nextState(awaiting(T0), keyAction("o", { ignored: true, now: T0 + 300 }))
    expect(result.state).toEqual({ phase: "awaiting", startedAt: T0 })
    expect(result.navigateTo).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("timeout behaviour", () => {
  it("tick before timeout keeps awaiting state", () => {
    const result = nextState(awaiting(T0), tickAction(T0 + TIMEOUT_MS - 1))
    expect(result.state).toEqual({ phase: "awaiting", startedAt: T0 })
  })

  it("tick past timeout resets to idle", () => {
    const result = nextState(awaiting(T0), tickAction(T0 + TIMEOUT_MS + 1))
    expect(result.state).toEqual({ phase: "idle" })
  })

  it("key received after timeout resets to idle (no navigation)", () => {
    const result = nextState(awaiting(T0), keyAction("o", { now: T0 + TIMEOUT_MS + 1 }))
    expect(result.state).toEqual({ phase: "idle" })
    expect(result.navigateTo).toBeUndefined()
  })

  it("pressing g after timeout re-enters awaiting with new timestamp", () => {
    const newT = T0 + TIMEOUT_MS + 1
    const result = nextState(awaiting(T0), keyAction("g", { now: newT }))
    expect(result.state).toEqual({ phase: "awaiting", startedAt: newT })
  })
})

// ---------------------------------------------------------------------------
// Sequence: g → o workflow
// ---------------------------------------------------------------------------

describe("full g+o sequence", () => {
  it("g then o produces a navigate to overview", () => {
    const afterG = nextState(idle, keyAction("g", { now: T0 }))
    expect(afterG.state.phase).toBe("awaiting")

    const afterO = nextState(afterG.state, keyAction("o", { now: T0 + 200 }))
    expect(afterO.state.phase).toBe("idle")
    expect(afterO.navigateTo).toBe("overview")
  })

  it("g then unknown key cancels, second g+s succeeds", () => {
    let state: ShortcutState = idle

    // First attempt: g → x (cancel)
    state = nextState(state, keyAction("g", { now: T0 })).state
    state = nextState(state, keyAction("x", { now: T0 + 100 })).state
    expect(state.phase).toBe("idle")

    // Second attempt: g → s (success)
    state = nextState(state, keyAction("g", { now: T0 + 500 })).state
    const result = nextState(state, keyAction("s", { now: T0 + 600 }))
    expect(result.navigateTo).toBe("settings")
  })
})

// ---------------------------------------------------------------------------
// Modifier key (Cmd+G) ignored
// ---------------------------------------------------------------------------

describe("modifier key safety", () => {
  it("Cmd+G does not enter awaiting", () => {
    const result = nextState(idle, keyAction("g", { modKey: true, now: T0 }))
    expect(result.state.phase).toBe("idle")
  })

  it("Ctrl+G does not enter awaiting", () => {
    const result = nextState(idle, keyAction("g", { modKey: true, now: T0 }))
    expect(result.state.phase).toBe("idle")
  })
})
