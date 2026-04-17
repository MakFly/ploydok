// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for detectLanguage() — pure function, no DOM required.
 */
import { describe, expect, it } from "bun:test"
import { detectLanguage } from "../../lib/env-language-detect"

describe("detectLanguage", () => {
  // ---------------------------------------------------------------------------
  // JSON
  // ---------------------------------------------------------------------------
  it("detects valid JSON object", () => {
    expect(detectLanguage('{"key": "value", "num": 42}')).toBe("json")
  })

  it("detects valid JSON array", () => {
    expect(detectLanguage('["a", "b", "c"]')).toBe("json")
  })

  it("detects JSON with leading whitespace", () => {
    expect(detectLanguage('  {\n  "a": 1\n}')).toBe("json")
  })

  it("falls through to plaintext for invalid JSON starting with {", () => {
    // Looks like JSON but isn't valid — should not return json.
    const result = detectLanguage("{invalid json here}")
    expect(result).not.toBe("json")
  })

  // ---------------------------------------------------------------------------
  // YAML
  // ---------------------------------------------------------------------------
  it("detects YAML with --- prefix", () => {
    expect(detectLanguage("---\nname: foo\nvalue: bar")).toBe("yaml")
  })

  it("detects YAML key: value format", () => {
    expect(detectLanguage("host: localhost\nport: 5432\ndb: mydb")).toBe("yaml")
  })

  it("does not false-positive on a plain string with colon", () => {
    // A simple "key:value" without space after colon should not be yaml.
    const result = detectLanguage("http://example.com")
    expect(result).not.toBe("yaml")
  })

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  it("detects shebang as shell", () => {
    expect(detectLanguage("#!/bin/bash\necho hello")).toBe("shell")
  })

  it("detects export statement as shell", () => {
    expect(detectLanguage("export DATABASE_URL=postgres://localhost/mydb\nexport PORT=5432")).toBe(
      "shell",
    )
  })

  // ---------------------------------------------------------------------------
  // PEM / certificate
  // ---------------------------------------------------------------------------
  it("detects PEM certificate as plaintext", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgA...\n-----END CERTIFICATE-----"
    expect(detectLanguage(pem)).toBe("plaintext")
  })

  it("detects RSA private key as plaintext", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...\n-----END RSA PRIVATE KEY-----"
    expect(detectLanguage(key)).toBe("plaintext")
  })

  // ---------------------------------------------------------------------------
  // Plaintext / default
  // ---------------------------------------------------------------------------
  it("returns plaintext for a simple string", () => {
    expect(detectLanguage("hello world")).toBe("plaintext")
  })

  it("returns plaintext for a URL-like string", () => {
    expect(detectLanguage("https://api.example.com/v1")).toBe("plaintext")
  })

  it("returns plaintext for empty string", () => {
    expect(detectLanguage("")).toBe("plaintext")
  })

  it("returns plaintext for a plain multiline string without YAML markers", () => {
    expect(detectLanguage("line one\nline two\nline three")).toBe("plaintext")
  })
})
