// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for use-command-palette.ts — pure keyboard event logic.
 * No DOM, no React, no router needed.
 */
import { describe, expect, it } from "bun:test"
import {

  resolveKeyAction
} from "../../../lib/hooks/use-command-palette"
import type {KeyEventInput} from "../../../lib/hooks/use-command-palette";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  key: string,
  opts: { metaKey?: boolean; ctrlKey?: boolean } = {},
): KeyEventInput {
  return {
    key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
  }
}

// ---------------------------------------------------------------------------
// Cmd/Ctrl + K → toggle
// ---------------------------------------------------------------------------

describe("resolveKeyAction — Cmd/Ctrl+K", () => {
  it("returns toggle when metaKey+k pressed (palette closed)", () => {
    const result = resolveKeyAction(makeEvent("k", { metaKey: true }), false)
    expect(result.action).toBe("toggle")
    expect(result.preventDefault).toBe(true)
  })

  it("returns toggle when metaKey+k pressed (palette open)", () => {
    const result = resolveKeyAction(makeEvent("k", { metaKey: true }), true)
    expect(result.action).toBe("toggle")
    expect(result.preventDefault).toBe(true)
  })

  it("returns toggle when ctrlKey+k pressed (palette closed)", () => {
    const result = resolveKeyAction(makeEvent("k", { ctrlKey: true }), false)
    expect(result.action).toBe("toggle")
    expect(result.preventDefault).toBe(true)
  })

  it("returns toggle when ctrlKey+k pressed (palette open)", () => {
    const result = resolveKeyAction(makeEvent("k", { ctrlKey: true }), true)
    expect(result.action).toBe("toggle")
    expect(result.preventDefault).toBe(true)
  })

  it("ignores plain k (no modifier)", () => {
    const result = resolveKeyAction(makeEvent("k"), false)
    expect(result.action).toBe("none")
    expect(result.preventDefault).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Escape → close (only when open)
// ---------------------------------------------------------------------------

describe("resolveKeyAction — Escape", () => {
  it("returns close when Escape pressed and palette is open", () => {
    const result = resolveKeyAction(makeEvent("Escape"), true)
    expect(result.action).toBe("close")
    expect(result.preventDefault).toBe(true)
  })

  it("returns none when Escape pressed and palette is closed", () => {
    const result = resolveKeyAction(makeEvent("Escape"), false)
    expect(result.action).toBe("none")
    expect(result.preventDefault).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Other keys → no-op
// ---------------------------------------------------------------------------

describe("resolveKeyAction — other keys", () => {
  it("ignores arbitrary key with no modifiers", () => {
    const result = resolveKeyAction(makeEvent("a"), false)
    expect(result.action).toBe("none")
  })

  it("ignores metaKey+j (not k)", () => {
    const result = resolveKeyAction(makeEvent("j", { metaKey: true }), false)
    expect(result.action).toBe("none")
  })

  it("ignores Enter", () => {
    const result = resolveKeyAction(makeEvent("Enter"), true)
    expect(result.action).toBe("none")
  })
})
