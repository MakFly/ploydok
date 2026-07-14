// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for use-log-stream helpers.
 * Validates parseLine (via detectLevel) and the pure filter exports.
 */
import { describe, expect, it } from "bun:test"
import {
  createLogEntryNormalizer,
  detectLevel,
  filterByLevel,
  filterBySearch,
  parseLogEntries,
  parseStructuredLine,
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

  it("handles Symfony debug messages", () => {
    expect(detectLevel("PHP [debug] Checking for authenticator support.")).toBe(
      "debug"
    )
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
// parseLogEntries
// ---------------------------------------------------------------------------

describe("parseLogEntries", () => {
  it("splits Nginx FastCGI PHP stderr bundles into readable PHP lines", () => {
    const raw = `2026/04/28 19:46:19 [error] 40#40: *1263 FastCGI sent in stderr: "PHP message: [info] Matched route "home".; PHP message: [debug] Checking for authenticator support." while reading response header from upstream, client: 127.0.0.1, server: localhost, request: "GET / HTTP/1.1", upstream: "fastcgi://127.0.0.1:9000", host: "127.0.0.1"`

    const entries = parseLogEntries(raw, 123)

    expect(entries.map((entry) => entry.text)).toEqual([
      `PHP [info] Matched route "home".`,
      "PHP [debug] Checking for authenticator support.",
    ])
    expect(entries.every((entry) => entry.t === 123)).toBe(true)
    expect(entries.map((entry) => detectLevel(entry.text))).toEqual([
      "info",
      "debug",
    ])
  })

  it("preserves JSON envelope metadata when expanding FastCGI PHP messages", () => {
    const raw = JSON.stringify({
      t: 456,
      stream: "stderr",
      line: `2026/04/28 19:46:19 [error] 40#40: *1263 FastCGI sent in stderr: "PHP message: [debug] Notified event "kernel.request"; PHP message: [info] Done" while reading response header from upstream`,
    })

    const entries = parseLogEntries(raw, 123)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      t: 456,
      stream: "stderr",
      text: `PHP [debug] Notified event "kernel.request"`,
    })
    expect(entries[1]).toMatchObject({
      t: 456,
      stream: "stderr",
      text: "PHP [info] Done",
    })
  })

  it("leaves non-PHP FastCGI stderr lines unchanged", () => {
    const raw = `2026/04/28 19:46:19 [error] 40#40: *1263 FastCGI sent in stderr: "Primary script unknown" while reading response header from upstream`

    const entries = parseLogEntries(raw, 123)

    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe(raw)
    expect(detectLevel(entries[0].text)).toBe("error")
  })

  it("rejoins split FastCGI chunks from the same Nginx request before parsing", () => {
    const normalizer = createLogEntryNormalizer()
    const first = `2026/04/28 19:58:13 [error] 41#41: *1541 FastCGI sent in stderr: "PHP message: [debug] Notified event "kernel.controller_arguments" to listener "Symf`
    const second = `2026/04/28 19:58:13 [error] 41#41: *1541 FastCGI sent in stderr: "ner\\SessionListener::onKernelResponse".; PHP message: [debug] Notified event "kernel.finish_request" to listener "Symfony\\Component\\HttpKernel\\EventListener\\LocaleListener::onKernelFinishRequest"" while reading response header from upstream`

    expect(normalizer.append(first, 123)).toEqual([])
    const entries = normalizer.append(second, 124)

    expect(entries.map((entry) => entry.text)).toEqual([
      `PHP [debug] Notified event "kernel.controller_arguments" to listener "Symfner\\SessionListener::onKernelResponse".`,
      `PHP [debug] Notified event "kernel.finish_request" to listener "Symfony\\Component\\HttpKernel\\EventListener\\LocaleListener::onKernelFinishRequest"`,
    ])
    expect(entries.every((entry) => detectLevel(entry.text) === "debug")).toBe(
      true
    )
    expect(entries.every((entry) => entry.t === 123)).toBe(true)
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
    cap: number
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

// ---------------------------------------------------------------------------
// parseStructuredLine — JSON
// ---------------------------------------------------------------------------

describe("parseStructuredLine — JSON", () => {
  it("extracts message and fields from a JSON object", () => {
    const parsed = parseStructuredLine(
      '{"level":"info","msg":"server started","port":3000}'
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.format).toBe("json")
    expect(parsed?.message).toBe("server started")
    expect(parsed?.fields).toEqual([
      { key: "level", value: "info" },
      { key: "port", value: "3000" },
    ])
  })

  it("stringifies nested object/array values", () => {
    const parsed = parseStructuredLine('{"message":"x","meta":{"a":1},"tags":[1,2]}')
    expect(parsed?.message).toBe("x")
    expect(parsed?.fields).toEqual([
      { key: "meta", value: '{"a":1}' },
      { key: "tags", value: "[1,2]" },
    ])
  })

  it("returns null for JSON arrays and plain text", () => {
    expect(parseStructuredLine("[1,2,3]")).toBeNull()
    expect(parseStructuredLine("just a normal log line")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseStructuredLine — logfmt
// ---------------------------------------------------------------------------

describe("parseStructuredLine — logfmt", () => {
  it("parses key=value pairs with quoted values", () => {
    const parsed = parseStructuredLine(
      'level=error msg="db connection refused" retries=3'
    )
    expect(parsed?.format).toBe("logfmt")
    expect(parsed?.message).toBe("db connection refused")
    expect(parsed?.fields).toEqual([
      { key: "level", value: "error" },
      { key: "retries", value: "3" },
    ])
  })

  it("does not treat a lone key=value or prose as logfmt", () => {
    expect(parseStructuredLine("FOO=bar")).toBeNull()
    expect(parseStructuredLine("the result was x=1 after run")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// detectLevel — structured level fields take precedence over message keywords
// ---------------------------------------------------------------------------

describe("detectLevel — structured level fields", () => {
  it("prefers the JSON level over conflicting message keywords", () => {
    // Heuristic would see "error" in the message; the structured level wins.
    expect(
      detectLevel('{"level":"info","msg":"error handler registered"}')
    ).toBe("info")
  })

  it("prefers the logfmt level over conflicting message keywords", () => {
    expect(detectLevel('level=info msg="error handler registered"')).toBe("info")
  })

  it("maps fatal/warning synonyms from structured logs", () => {
    expect(detectLevel('level=fatal msg="down" component=db')).toBe("error")
    expect(detectLevel('{"severity":"warning","msg":"slow"}')).toBe("warn")
  })
})
