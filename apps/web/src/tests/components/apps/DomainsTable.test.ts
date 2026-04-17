// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for DomainsTable pure logic helpers.
 * Covers: hostname validation regex.
 */
import { describe, expect, it } from "bun:test"

// ---------------------------------------------------------------------------
// Hostname validation — mirrors the HOSTNAME_REGEX in DomainsTable.tsx
// ---------------------------------------------------------------------------

const HOSTNAME_REGEX = /^[a-z0-9][a-z0-9.-]{1,253}\.[a-z]{2,}$/i

function validateHostname(hostname: string): string | undefined {
  if (!hostname) return "Hostname is required"
  if (!HOSTNAME_REGEX.test(hostname.trim())) {
    return "Invalid hostname (e.g. app.example.com)"
  }
  return undefined
}

describe("DomainsTable — validateHostname", () => {
  it("accepts a simple two-level hostname", () => {
    expect(validateHostname("example.com")).toBeUndefined()
  })

  it("accepts a three-level subdomain", () => {
    expect(validateHostname("app.example.com")).toBeUndefined()
  })

  it("accepts a deep subdomain", () => {
    expect(validateHostname("a.b.c.example.co.uk")).toBeUndefined()
  })

  it("accepts uppercase (validation is case-insensitive)", () => {
    expect(validateHostname("UPPER.EXAMPLE.COM")).toBeUndefined()
  })

  it("accepts hyphens in labels", () => {
    expect(validateHostname("my-app.example.com")).toBeUndefined()
  })

  it("rejects empty string", () => {
    expect(validateHostname("")).toBeDefined()
  })

  it("rejects a bare label with no dot", () => {
    expect(validateHostname("localhost")).toBeDefined()
  })

  it("rejects a hostname without a valid TLD (single-char TLD)", () => {
    expect(validateHostname("app.x")).toBeDefined()
  })

  it("rejects a plain IPv4 address", () => {
    expect(validateHostname("192.168.1.1")).toBeDefined()
  })

  it("rejects a hostname starting with a hyphen", () => {
    expect(validateHostname("-bad.example.com")).toBeDefined()
  })

  it("rejects a hostname with spaces", () => {
    expect(validateHostname("my app.example.com")).toBeDefined()
  })

  it("rejects a hostname with underscore in TLD position", () => {
    // underscore is technically invalid in DNS labels
    expect(validateHostname("app.example._com")).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// TLS status shape (type guard-style tests)
// ---------------------------------------------------------------------------

type TlsStatus = "pending" | "issued" | "failed"

const VALID_STATUSES: Array<TlsStatus> = ["pending", "issued", "failed"]

describe("DomainsTable — TLS status values", () => {
  it("has exactly three valid statuses", () => {
    expect(VALID_STATUSES).toHaveLength(3)
  })

  it("includes pending, issued, failed", () => {
    expect(VALID_STATUSES).toContain("pending")
    expect(VALID_STATUSES).toContain("issued")
    expect(VALID_STATUSES).toContain("failed")
  })
})
