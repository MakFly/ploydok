// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for EnvTable pure logic helpers.
 * Covers: key validation, diff detection, secret masking logic.
 */
import { describe, expect, it } from "bun:test"
import { validateKey, hasDiff, shouldOfferMultilineEdit } from "../../../components/apps/EnvTable"
import type { EnvVar, EnvVarPatch } from "../../../lib/apps-env"

// ---------------------------------------------------------------------------
// validateKey
// ---------------------------------------------------------------------------

describe("validateKey", () => {
  it("accepts valid UPPER_SNAKE_CASE keys", () => {
    expect(validateKey("MY_VAR")).toBeUndefined()
    expect(validateKey("DATABASE_URL")).toBeUndefined()
    expect(validateKey("A")).toBeUndefined()
    expect(validateKey("A1")).toBeUndefined()
    expect(validateKey("MY_VAR_123")).toBeUndefined()
  })

  it("rejects lowercase keys", () => {
    expect(validateKey("my_var")).toBeDefined()
    expect(validateKey("myVar")).toBeDefined()
  })

  it("rejects keys starting with a digit", () => {
    expect(validateKey("1VAR")).toBeDefined()
  })

  it("rejects keys starting with underscore", () => {
    expect(validateKey("_VAR")).toBeDefined()
  })

  it("rejects empty string", () => {
    expect(validateKey("")).toBeDefined()
  })

  it("rejects keys with spaces", () => {
    expect(validateKey("MY VAR")).toBeDefined()
  })

  it("rejects keys with hyphens", () => {
    expect(validateKey("MY-VAR")).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// hasDiff
// ---------------------------------------------------------------------------

const makeServer = (key: string, value: string, secret = false): EnvVar => ({
  key,
  value,
  secret,
})

const makePatch = (key: string, value: string, secret = false): EnvVarPatch => ({
  key,
  value,
  secret,
})

describe("hasDiff", () => {
  it("returns false when local and server are identical", () => {
    const server = [makeServer("FOO", "bar")]
    const local = [makePatch("FOO", "bar")]
    expect(hasDiff(local, server)).toBe(false)
  })

  it("returns false for empty → empty", () => {
    expect(hasDiff([], [])).toBe(false)
  })

  it("returns true when a var is added", () => {
    const server: EnvVar[] = []
    const local = [makePatch("FOO", "bar")]
    expect(hasDiff(local, server)).toBe(true)
  })

  it("returns true when a var is removed", () => {
    const server = [makeServer("FOO", "bar")]
    const local: EnvVarPatch[] = []
    expect(hasDiff(local, server)).toBe(true)
  })

  it("returns true when a value is changed", () => {
    const server = [makeServer("FOO", "bar")]
    const local = [makePatch("FOO", "baz")]
    expect(hasDiff(local, server)).toBe(true)
  })

  it("returns true when secret flag changes", () => {
    const server = [makeServer("FOO", "bar", false)]
    const local = [makePatch("FOO", "bar", true)]
    expect(hasDiff(local, server)).toBe(true)
  })

  it("returns false for a secret var still showing the mask", () => {
    // When the user has NOT edited the secret value, it stays as "********".
    // hasDiff must treat this as unchanged (no diff vs server).
    const server = [makeServer("SECRET_KEY", "actual-value", true)]
    const local = [makePatch("SECRET_KEY", "********", true)]
    expect(hasDiff(local, server)).toBe(false)
  })

  it("returns true for a secret var whose mask was replaced with a new value", () => {
    const server = [makeServer("SECRET_KEY", "actual-value", true)]
    const local = [makePatch("SECRET_KEY", "new-secret", true)]
    expect(hasDiff(local, server)).toBe(true)
  })

  it("handles multiple vars correctly — no diff", () => {
    const server = [makeServer("A", "1"), makeServer("B", "2", true)]
    // Secret B still shows mask → no diff.
    const local = [makePatch("A", "1"), makePatch("B", "********", true)]
    expect(hasDiff(local, server)).toBe(false)
  })

  it("handles multiple vars correctly — diff present", () => {
    const server = [makeServer("A", "1"), makeServer("B", "2")]
    const local = [makePatch("A", "changed"), makePatch("B", "2")]
    expect(hasDiff(local, server)).toBe(true)
  })

  it("returns true when key is renamed", () => {
    const server = [makeServer("FOO", "val")]
    const local = [makePatch("BAR", "val")]
    expect(hasDiff(local, server)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// shouldOfferMultilineEdit
// ---------------------------------------------------------------------------

describe("shouldOfferMultilineEdit", () => {
  it("returns false for a short value", () => {
    expect(shouldOfferMultilineEdit("hello")).toBe(false)
  })

  it("returns false for value of exactly 80 chars", () => {
    expect(shouldOfferMultilineEdit("x".repeat(80))).toBe(false)
  })

  it("returns true for value of 81+ chars", () => {
    expect(shouldOfferMultilineEdit("x".repeat(81))).toBe(true)
  })

  it("returns true when value contains a newline", () => {
    expect(shouldOfferMultilineEdit("line1\nline2")).toBe(true)
  })

  it("returns false for empty string", () => {
    expect(shouldOfferMultilineEdit("")).toBe(false)
  })

  it("returns true for a long JWT token (single line, >80 chars)", () => {
    const token = "eyJ" + "a".repeat(100)
    expect(shouldOfferMultilineEdit(token)).toBe(true)
  })
})
