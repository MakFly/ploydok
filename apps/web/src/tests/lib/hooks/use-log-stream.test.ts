// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for use-log-stream helpers.
 * Validates parseLine (via detectLevel) and the pure filter exports.
 */
import { describe, expect, it } from "bun:test"
import {
  detectLevel,
  filterByLevel,
  filterBySearch,
} from "../../../lib/hooks/use-log-stream"
import type { LogLine } from "../../../lib/hooks/use-log-stream"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function line(id: number, text: string): LogLine {
  return { id, text }
}

// ---------------------------------------------------------------------------
// detectLevel — edge cases not covered by LogFilters.test.ts
// ---------------------------------------------------------------------------

describe("detectLevel — extended edge cases", () => {
  it("handles multi-word lines with err: suffix", () => {
    expect(detectLevel("read err: connection reset")).toBe("error")
  })

  it("handles Docker build output (step lines are info)", () => {
    expect(detectLevel("Step 1/12 : FROM node:20-alpine")).toBe("info")
  })

  it("handles npm warnings", () => {
    expect(detectLevel("npm warn deprecated lodash@4.17.21")).toBe("warn")
  })

  it("handles Go log format [error]", () => {
    // Should match error regex
    expect(detectLevel("[error] failed to dial")).toBe("error")
  })

  it("handles stderr lines without explicit level marker", () => {
    // Plain text with no keyword — defaults to info
    expect(detectLevel("Listening on 0.0.0.0:3000")).toBe("info")
  })
})

// ---------------------------------------------------------------------------
// filterByLevel — combined with filterBySearch
// ---------------------------------------------------------------------------

describe("combined level + search filter", () => {
  const corpus: Array<LogLine> = [
    line(1, "[INFO] starting server"),
    line(2, "[WARN] high CPU usage"),
    line(3, "[ERROR] database connection refused"),
    line(4, "[INFO] request GET /health 200"),
    line(5, "[ERROR] request GET /api/fail 500"),
  ]

  it("level=error + search='request' returns only error request lines", () => {
    const byLevel = filterByLevel(corpus, "error")
    const result = filterBySearch(byLevel, "request")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(5)
  })

  it("level=info + search='server' returns only info server lines", () => {
    const byLevel = filterByLevel(corpus, "info")
    const result = filterBySearch(byLevel, "server")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it("level=all + search='' returns everything", () => {
    const byLevel = filterByLevel(corpus, "all")
    const result = filterBySearch(byLevel, "")
    expect(result).toHaveLength(corpus.length)
  })

  it("level=warn + search='cpu' returns 1 line", () => {
    const byLevel = filterByLevel(corpus, "warn")
    const result = filterBySearch(byLevel, "cpu")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// maxLines trimming logic (mirrored from hook implementation)
// ---------------------------------------------------------------------------

describe("maxLines cap logic", () => {
  /**
   * Mirrors the trimming logic in useLogStream's appendLine:
   * next.length > cap → keep only the last `cap` lines.
   */
  function simulateCap(
    existing: Array<LogLine>,
    newLine: LogLine,
    cap: number,
  ): Array<LogLine> {
    const next = [...existing, newLine]
    return next.length > cap ? next.slice(next.length - cap) : next
  }

  it("appends without trimming when under cap", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const result = simulateCap(lines, line(3, "c"), 10)
    expect(result).toHaveLength(3)
  })

  it("trims oldest line when cap is reached", () => {
    const lines = [line(1, "a"), line(2, "b"), line(3, "c")]
    const result = simulateCap(lines, line(4, "d"), 3)
    expect(result).toHaveLength(3)
    expect(result[0].id).toBe(2) // oldest (id=1) was dropped
    expect(result[result.length - 1].id).toBe(4) // newest retained
  })

  it("cap=1 always keeps only the newest line", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const result = simulateCap(lines, line(3, "c"), 1)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(3)
  })

  it("cap exactly equal to existing count does not trim before append", () => {
    const lines = [line(1, "a"), line(2, "b")]
    // 2 existing + 1 new = 3 > cap 2 → trim to 2 most recent
    const result = simulateCap(lines, line(3, "c"), 2)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe(2)
    expect(result[1].id).toBe(3)
  })
})
