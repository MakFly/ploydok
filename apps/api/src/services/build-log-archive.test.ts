// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  MAX_RAW_LOG_BYTES,
  compressLog,
  decompressLog,
  truncateLog,
} from "./build-log-archive"

describe("truncateLog", () => {
  it("returns the buffer unchanged when under the cap", () => {
    const raw = Buffer.from("hello world")
    const result = truncateLog(raw)
    expect(result.truncated).toBe(false)
    expect(result.originalSize).toBe(11)
    expect(result.content).toEqual(raw)
  })

  it("truncates oversize payloads to head + marker + tail", () => {
    const big = Buffer.alloc(MAX_RAW_LOG_BYTES + 10 * 1024 * 1024, 0x41) // 60 MB of 'A'
    const result = truncateLog(big)
    expect(result.truncated).toBe(true)
    expect(result.originalSize).toBe(big.length)
    // Total = 25 MB head + marker + 25 MB tail; marker adds < 1 KB.
    expect(result.content.length).toBeLessThan(MAX_RAW_LOG_BYTES + 1024)
    expect(result.content.length).toBeGreaterThan(MAX_RAW_LOG_BYTES - 1024)
    const text = result.content.toString("utf8")
    expect(text).toContain("[... TRUNCATED")
    expect(text).toContain("MB (kept first 25 MB and last 25 MB) ...]")
  })
})

describe("compressLog / decompressLog", () => {
  it("round-trips a small payload", () => {
    const raw = Buffer.from("hello world\n".repeat(100))
    const { archive, rawSize, compressedSize } = compressLog(raw)
    expect(rawSize).toBe(raw.length)
    expect(compressedSize).toBeGreaterThan(0)
    expect(compressedSize).toBeLessThan(raw.length)
    expect(decompressLog(archive)).toEqual(raw)
  })

  it("compresses repetitive content with high ratio", () => {
    const raw = Buffer.from("a".repeat(10_000))
    const { archive, rawSize, compressedSize } = compressLog(raw)
    expect(rawSize).toBe(10_000)
    expect(compressedSize).toBeLessThan(200) // gzip ratio > 50x on pure repetition
    expect(decompressLog(archive).length).toBe(10_000)
  })

  it("produces a base64 string with no embedded nulls", () => {
    const raw = Buffer.from("test")
    const { archive } = compressLog(raw)
    expect(typeof archive).toBe("string")
    expect(archive).toMatch(/^[A-Za-z0-9+/=]+$/)
  })
})
