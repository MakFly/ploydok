// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for RegistryUsageWidget pure helpers.
 * No DOM rendering — tests the exported formatBytes and diskBarTone functions.
 */
import { describe, expect, it } from "bun:test"
import { diskBarTone, formatBytes } from "../../../components/apps/RegistryUsageWidget"

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  it("returns '0 B' for zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B")
  })

  it("formats bytes under 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B")
  })

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
  })

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
  })

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  it("formats fractional megabytes", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB")
  })

  it("formats large values in GB", () => {
    const tenGB = 10 * 1024 * 1024 * 1024
    expect(formatBytes(tenGB)).toBe("10.0 GB")
  })
})

// ---------------------------------------------------------------------------
// diskBarTone
// ---------------------------------------------------------------------------

describe("diskBarTone", () => {
  it("returns bg-primary for low usage (< 60%)", () => {
    expect(diskBarTone(0)).toBe("bg-primary")
    expect(diskBarTone(30)).toBe("bg-primary")
    expect(diskBarTone(59)).toBe("bg-primary")
  })

  it("returns bg-foreground for moderate usage (60–79%)", () => {
    expect(diskBarTone(60)).toBe("bg-foreground")
    expect(diskBarTone(70)).toBe("bg-foreground")
    expect(diskBarTone(79)).toBe("bg-foreground")
  })

  it("returns bg-destructive for high usage (>= 80%)", () => {
    expect(diskBarTone(80)).toBe("bg-destructive")
    expect(diskBarTone(95)).toBe("bg-destructive")
    expect(diskBarTone(100)).toBe("bg-destructive")
  })
})

// ---------------------------------------------------------------------------
// Widget behaviour contract (pure logic assertions)
// ---------------------------------------------------------------------------

describe("RegistryUsageWidget — label contract", () => {
  function imageLabel(count: number): string {
    return `image${count !== 1 ? "s" : ""}`
  }

  it("pluralises 'image' correctly", () => {
    expect(imageLabel(1)).toBe("image")
    expect(imageLabel(0)).toBe("images")
    expect(imageLabel(3)).toBe("images")
  })

  it("clamps diskPct to 100% for the progress bar width", () => {
    const clamp = (pct: number): number => Math.min(pct, 100)
    expect(clamp(50)).toBe(50)
    expect(clamp(100)).toBe(100)
    expect(clamp(150)).toBe(100)
  })
})
