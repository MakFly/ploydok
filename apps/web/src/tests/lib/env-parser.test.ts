// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { looksSecret, parseDotenv } from "../../lib/env-parser"

describe("parseDotenv", () => {
  it("parses simple KEY=value pairs", () => {
    const result = parseDotenv("FOO=bar\nBAZ=qux")
    expect(result.errors).toEqual([])
    expect(result.entries).toEqual([
      { key: "FOO", value: "bar", line: 1 },
      { key: "BAZ", value: "qux", line: 2 },
    ])
  })

  it("ignores comments and blank lines", () => {
    const result = parseDotenv("# a comment\n\nFOO=bar\n\n# another\nBAZ=qux\n")
    expect(result.errors).toEqual([])
    expect(result.entries.map((e) => e.key)).toEqual(["FOO", "BAZ"])
  })

  it("strips the `export` prefix", () => {
    const result = parseDotenv("export FOO=bar")
    expect(result.entries).toEqual([{ key: "FOO", value: "bar", line: 1 }])
  })

  it("handles double-quoted values and escapes", () => {
    const result = parseDotenv(`FOO="hello \\"world\\""\nBAR="line1\\nline2"`)
    expect(result.errors).toEqual([])
    expect(result.entries[0].value).toBe('hello "world"')
    expect(result.entries[1].value).toBe("line1\nline2")
  })

  it("handles single-quoted values as literal", () => {
    const result = parseDotenv(`FOO='hello\\nworld'`)
    expect(result.entries[0].value).toBe("hello\\nworld")
  })

  it("supports multiline quoted values", () => {
    const src = `PRIVATE_KEY="-----BEGIN-----\nline2\nline3\n-----END-----"`
    const result = parseDotenv(src)
    expect(result.errors).toEqual([])
    expect(result.entries[0].key).toBe("PRIVATE_KEY")
    expect(result.entries[0].value).toContain("line2")
    expect(result.entries[0].value.split("\n").length).toBe(4)
  })

  it("strips inline comments from unquoted values", () => {
    const result = parseDotenv("FOO=bar # comment here")
    expect(result.entries[0].value).toBe("bar")
  })

  it("keeps `#` inside quoted values", () => {
    const result = parseDotenv(`FOO="bar#notacomment"`)
    expect(result.entries[0].value).toBe("bar#notacomment")
  })

  it("reports invalid keys", () => {
    const result = parseDotenv("1BAD=ok\nFOO=bar")
    expect(result.errors.length).toBe(1)
    expect(result.errors[0].line).toBe(1)
    expect(result.entries.map((e) => e.key)).toEqual(["FOO"])
  })

  it("reports missing equals", () => {
    const result = parseDotenv("NOEQUAL\nFOO=bar")
    expect(result.errors.length).toBe(1)
    expect(result.entries.map((e) => e.key)).toEqual(["FOO"])
  })

  it("dedupes keys, keeping the last occurrence", () => {
    const result = parseDotenv("FOO=first\nFOO=second")
    expect(result.entries).toEqual([{ key: "FOO", value: "second", line: 2 }])
  })

  it("reports unterminated quoted value", () => {
    const result = parseDotenv(`FOO="no closing quote`)
    expect(result.errors.length).toBe(1)
  })

  it("handles CRLF line endings", () => {
    const result = parseDotenv("FOO=bar\r\nBAZ=qux\r\n")
    expect(result.entries.map((e) => e.key)).toEqual(["FOO", "BAZ"])
  })
})

describe("looksSecret", () => {
  it("detects common secret-looking keys", () => {
    expect(looksSecret("API_KEY")).toBe(true)
    expect(looksSecret("DATABASE_PASSWORD")).toBe(true)
    expect(looksSecret("GITHUB_TOKEN")).toBe(true)
    expect(looksSecret("JWT_SECRET")).toBe(true)
    expect(looksSecret("PRIVATE_KEY")).toBe(true)
  })

  it("returns false for plain keys", () => {
    expect(looksSecret("PORT")).toBe(false)
    expect(looksSecret("NODE_ENV")).toBe(false)
    expect(looksSecret("HOSTNAME")).toBe(false)
  })
})
