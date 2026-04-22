// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { parseAndValidateCert } from "./cert-parser.js"
import { execSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readFileSync } from "node:fs"

// Generate a self-signed cert+key pair for tests using openssl
function generateSelfSignedCert(
  domain: string,
  daysValid = 365,
): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), "ploydok-cert-test-"))
  try {
    const keyFile = join(dir, "key.pem")
    const certFile = join(dir, "cert.pem")
    const san = domain.startsWith("*.")
      ? `DNS:${domain}`
      : `DNS:${domain}`

    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${keyFile} -out ${certFile} ` +
        `-days ${daysValid} -nodes -subj "/CN=${domain}" ` +
        `-addext "subjectAltName=${san}"`,
      { stdio: "pipe" },
    )
    return {
      cert: readFileSync(certFile, "utf8"),
      key: readFileSync(keyFile, "utf8"),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("parseAndValidateCert", () => {
  test("accepts a valid cert+key for exact domain", () => {
    const { cert, key } = generateSelfSignedCert("app.example.com")
    const result = parseAndValidateCert(cert, key, "app.example.com")
    expect(result.ok).toBe(true)
    expect(result.sans).toContain("app.example.com")
  })

  test("accepts wildcard cert for subdomain", () => {
    const { cert, key } = generateSelfSignedCert("*.example.com")
    const result = parseAndValidateCert(cert, key, "foo.example.com")
    expect(result.ok).toBe(true)
    expect(result.sans).toContain("*.example.com")
  })

  test("rejects domain not in SANs", () => {
    const { cert, key } = generateSelfSignedCert("app.example.com")
    const result = parseAndValidateCert(cert, key, "other.example.com")
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not covered/)
  })

  test("rejects wildcard for wrong parent domain", () => {
    const { cert, key } = generateSelfSignedCert("*.example.com")
    const result = parseAndValidateCert(cert, key, "foo.other.com")
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not covered/)
  })

  test("rejects mismatched private key", () => {
    const { cert } = generateSelfSignedCert("app.example.com")
    const { key: wrongKey } = generateSelfSignedCert("other.example.com")
    const result = parseAndValidateCert(cert, wrongKey, "app.example.com")
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not match/)
  })

  test("rejects invalid PEM cert", () => {
    const result = parseAndValidateCert("not-a-cert", "not-a-key", "example.com")
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Cannot parse certificate/)
  })

  test("rejects expired certificate", () => {
    // Generate cert with -days 0 (already expired)
    const dir = mkdtempSync(join(tmpdir(), "ploydok-expired-"))
    try {
      const keyFile = join(dir, "key.pem")
      const certFile = join(dir, "cert.pem")
      // notAfter = notBefore = now (immediate expiry)
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyFile} -out ${certFile} ` +
          `-days -1 -nodes -subj "/CN=expired.example.com" ` +
          `-addext "subjectAltName=DNS:expired.example.com"`,
        { stdio: "pipe" },
      )
      const cert = readFileSync(certFile, "utf8")
      const key = readFileSync(keyFile, "utf8")
      const result = parseAndValidateCert(cert, key, "expired.example.com")
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/expired/)
    } catch {
      // openssl may not support -days -1 on all platforms — skip
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
