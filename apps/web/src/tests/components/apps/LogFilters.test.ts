// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for LogFilters pure logic helpers.
 * No DOM rendering — validates level detection, volume cap, text filtering,
 * and search highlight segmentation.
 */
import { describe, expect, it } from "bun:test"
import {
  detectLevel,
  filterByLevel,
  filterBySearch,
} from "../../../lib/hooks/use-log-stream"
import { formatVolume } from "../../../components/apps/LogFilters"
import { highlightMatches } from "../../../components/apps/LogLine"
import type { LogLine } from "../../../lib/hooks/use-log-stream"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function line(id: number, text: string): LogLine {
  return { id, text, t: Date.now() }
}

// ---------------------------------------------------------------------------
// detectLevel
// ---------------------------------------------------------------------------

describe("detectLevel", () => {
  it("detects [ERROR] prefix", () => {
    expect(detectLevel("[ERROR] something went wrong")).toBe("error")
  })

  it("detects ERROR: prefix", () => {
    expect(detectLevel("ERROR: cannot connect to database")).toBe("error")
  })

  it("detects fatal", () => {
    expect(detectLevel("fatal: kernel panic")).toBe("error")
  })

  it("detects panic", () => {
    expect(detectLevel("panic: runtime error")).toBe("error")
  })

  it("detects [WARN] prefix", () => {
    expect(detectLevel("[WARN] memory pressure detected")).toBe("warn")
  })

  it("detects WARN: prefix", () => {
    expect(detectLevel("WARN: disk usage above 80%")).toBe("warn")
  })

  it("detects warning word", () => {
    expect(detectLevel("warning: deprecated API used")).toBe("warn")
  })

  it("detects [DEBUG] prefix", () => {
    expect(detectLevel("[DEBUG] event listener notified")).toBe("debug")
  })

  it("detects DEBUG: prefix", () => {
    expect(detectLevel("DEBUG: checking authenticator support")).toBe("debug")
  })

  it("detects [INFO] prefix", () => {
    expect(detectLevel("[INFO] server started on port 3000")).toBe("info")
  })

  it("detects INFO: prefix", () => {
    expect(detectLevel("INFO: loaded config from /etc/app.yml")).toBe("info")
  })

  it("returns info for plain text lines", () => {
    expect(detectLevel("Server listening on :8080")).toBe("info")
  })

  it("returns info for empty lines", () => {
    expect(detectLevel("")).toBe("info")
  })

  it("is case-insensitive for error detection", () => {
    expect(detectLevel("Error: something bad")).toBe("error")
  })

  it("is case-insensitive for warn detection", () => {
    expect(detectLevel("Warning: slow query detected")).toBe("warn")
  })

  it("explicit level marker takes precedence over message text", () => {
    expect(detectLevel("[WARN] error rate is high")).toBe("warn")
    expect(detectLevel("PHP [debug] handled kernel.exception")).toBe("debug")
  })
})

// ---------------------------------------------------------------------------
// filterByLevel
// ---------------------------------------------------------------------------

describe("filterByLevel", () => {
  const lines: Array<LogLine> = [
    line(1, "[INFO] app started"),
    line(2, "[WARN] high memory"),
    line(3, "[ERROR] connection refused"),
    line(4, "INFO: request received"),
    line(5, "plain stdout line"),
    line(6, "[DEBUG] event listener notified"),
  ]

  it("returns all lines for level 'all'", () => {
    expect(filterByLevel(lines, "all")).toHaveLength(6)
  })

  it("filters to info lines only", () => {
    const result = filterByLevel(lines, "info")
    // lines 1, 4, 5 are info
    expect(result.every((l) => detectLevel(l.text) === "info")).toBe(true)
    expect(result.length).toBeGreaterThanOrEqual(3)
  })

  it("filters to warn lines only", () => {
    const result = filterByLevel(lines, "warn")
    expect(result.every((l) => detectLevel(l.text) === "warn")).toBe(true)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it("filters to debug lines only", () => {
    const result = filterByLevel(lines, "debug")
    expect(result.every((l) => detectLevel(l.text) === "debug")).toBe(true)
    expect(result).toHaveLength(1)
  })

  it("filters to error lines only", () => {
    const result = filterByLevel(lines, "error")
    expect(result.every((l) => detectLevel(l.text) === "error")).toBe(true)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it("returns empty array when no lines match", () => {
    const onlyInfo: Array<LogLine> = [
      line(1, "[INFO] all good"),
      line(2, "plain text"),
    ]
    expect(filterByLevel(onlyInfo, "error")).toHaveLength(0)
  })

  it("does not mutate the input array", () => {
    const input = [line(1, "[ERROR] bad"), line(2, "[INFO] ok")]
    const copy = [...input]
    filterByLevel(input, "info")
    expect(input).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------
// filterBySearch
// ---------------------------------------------------------------------------

describe("filterBySearch", () => {
  const lines: Array<LogLine> = [
    line(1, "2024-01-01 starting application"),
    line(2, "connected to database"),
    line(3, "ERROR: database connection failed"),
    line(4, "retrying connection…"),
  ]

  it("returns all lines for empty query", () => {
    expect(filterBySearch(lines, "")).toHaveLength(4)
  })

  it("returns all lines for whitespace-only query", () => {
    expect(filterBySearch(lines, "   ")).toHaveLength(4)
  })

  it("filters lines containing the query (case-insensitive)", () => {
    const result = filterBySearch(lines, "database")
    expect(result).toHaveLength(2)
    expect(result[0].text).toContain("database")
    expect(result[1].text).toContain("database")
  })

  it("is case-insensitive", () => {
    const result = filterBySearch(lines, "DATABASE")
    expect(result).toHaveLength(2)
  })

  it("returns empty array when nothing matches", () => {
    expect(filterBySearch(lines, "xyz-not-found")).toHaveLength(0)
  })

  it("trims leading/trailing whitespace from query", () => {
    const result = filterBySearch(lines, "  connection  ")
    expect(result.length).toBeGreaterThan(0)
    expect(
      result.every((l) => l.text.toLowerCase().includes("connection"))
    ).toBe(true)
  })

  it("does not mutate the input array", () => {
    const input = [line(1, "foo"), line(2, "bar")]
    const copy = [...input]
    filterBySearch(input, "foo")
    expect(input).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------
// Volume cap behaviour (simulated — mirrors use-log-stream logic)
// ---------------------------------------------------------------------------

describe("volume cap", () => {
  function applyVolumeCap(lines: Array<LogLine>, cap: number): Array<LogLine> {
    return lines.length > cap ? lines.slice(lines.length - cap) : lines
  }

  it("keeps all lines when count is within cap", () => {
    const input = Array.from({ length: 50 }, (_, i) => line(i, `line ${i}`))
    expect(applyVolumeCap(input, 100)).toHaveLength(50)
  })

  it("retains the MOST RECENT lines when over cap", () => {
    const input = Array.from({ length: 200 }, (_, i) => line(i, `line ${i}`))
    const result = applyVolumeCap(input, 100)
    expect(result).toHaveLength(100)
    // Last line should be the most recent (id = 199)
    expect(result[result.length - 1].id).toBe(199)
    // First line should be id 100 (oldest retained)
    expect(result[0].id).toBe(100)
  })

  it("cap of 0 results in empty array", () => {
    const input = [line(1, "a"), line(2, "b")]
    expect(applyVolumeCap(input, 0)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// formatVolume
// ---------------------------------------------------------------------------

describe("formatVolume", () => {
  it("formats 100 as '100'", () => {
    expect(formatVolume(100)).toBe("100")
  })

  it("formats 500 as '500'", () => {
    expect(formatVolume(500)).toBe("500")
  })

  it("formats 1000 as '1k'", () => {
    expect(formatVolume(1000)).toBe("1k")
  })

  it("formats 5000 as '5k'", () => {
    expect(formatVolume(5000)).toBe("5k")
  })
})

// ---------------------------------------------------------------------------
// highlightMatches — search highlight segmentation
// ---------------------------------------------------------------------------

describe("highlightMatches", () => {
  it("returns single non-match segment for empty query", () => {
    const result = highlightMatches("hello world", "")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ text: "hello world", isMatch: false })
  })

  it("returns single non-match segment for whitespace-only query", () => {
    const result = highlightMatches("hello world", "   ")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ text: "hello world", isMatch: false })
  })

  it("highlights a single match in the middle", () => {
    const result = highlightMatches("hello world foo", "world")
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ text: "hello ", isMatch: false })
    expect(result[1]).toEqual({ text: "world", isMatch: true })
    expect(result[2]).toEqual({ text: " foo", isMatch: false })
  })

  it("highlights a match at the start", () => {
    const result = highlightMatches("ERROR: bad thing", "ERROR")
    expect(result[0]).toEqual({ text: "ERROR", isMatch: true })
    expect(result[1].isMatch).toBe(false)
  })

  it("highlights a match at the end", () => {
    const result = highlightMatches("server crash", "crash")
    expect(result[result.length - 1]).toEqual({ text: "crash", isMatch: true })
  })

  it("is case-insensitive", () => {
    const result = highlightMatches("Hello World", "hello")
    expect(result[0]).toEqual({ text: "Hello", isMatch: true })
  })

  it("highlights multiple occurrences", () => {
    const result = highlightMatches("foo bar foo baz foo", "foo")
    const matches = result.filter((s) => s.isMatch)
    expect(matches).toHaveLength(3)
    expect(matches.every((s) => s.text === "foo")).toBe(true)
  })

  it("returns single non-match when query is not found", () => {
    const result = highlightMatches("hello world", "xyz")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ text: "hello world", isMatch: false })
  })

  it("escapes regex special characters in query", () => {
    // Should not throw and should match literal "("
    const result = highlightMatches("at parseConfig (config.ts:42)", "(")
    const matches = result.filter((s) => s.isMatch)
    expect(matches.length).toBeGreaterThan(0)
  })

  it("handles full-string match", () => {
    const result = highlightMatches("database", "database")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ text: "database", isMatch: true })
  })

  it("preserves total text across segments", () => {
    const text = "INFO: connected to database at startup"
    const result = highlightMatches(text, "database")
    const reconstructed = result.map((s) => s.text).join("")
    expect(reconstructed).toBe(text)
  })
})
