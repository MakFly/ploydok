// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for MonacoEnvEditorDialog pure logic.
 *
 * Monaco Editor is not rendered in these tests — it cannot run in a Bun/happy-dom
 * environment without a full browser. We test only the pure helpers:
 *   - shouldOfferMultilineEdit (imported from EnvTable)
 *   - detectLanguage (imported from env-language-detect)
 *
 * The save/cancel interaction relies on React state; those paths are covered
 * by the integration in EnvTable.test.ts and manual browser testing.
 */
import { describe, expect, it } from "bun:test"
import { shouldOfferMultilineEdit } from "../../../components/apps/EnvTable"
import { detectLanguage } from "../../../lib/env-language-detect"

// ---------------------------------------------------------------------------
// shouldOfferMultilineEdit
// ---------------------------------------------------------------------------

describe("shouldOfferMultilineEdit", () => {
  it("returns false for short single-line value", () => {
    expect(shouldOfferMultilineEdit("hello")).toBe(false)
  })

  it("returns false for value of exactly 80 chars", () => {
    expect(shouldOfferMultilineEdit("a".repeat(80))).toBe(false)
  })

  it("returns true for value longer than 80 chars", () => {
    expect(shouldOfferMultilineEdit("a".repeat(81))).toBe(true)
  })

  it("returns true when value contains a newline", () => {
    expect(shouldOfferMultilineEdit("line1\nline2")).toBe(true)
  })

  it("returns true for multiline JSON", () => {
    const json = '{\n  "key": "value",\n  "num": 42\n}'
    expect(shouldOfferMultilineEdit(json)).toBe(true)
  })

  it("returns true for multiline YAML", () => {
    const yaml = "---\nhost: localhost\nport: 5432"
    expect(shouldOfferMultilineEdit(yaml)).toBe(true)
  })

  it("returns true for a long single-line token (e.g. JWT)", () => {
    const jwt =
      "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImlhdCI6MTYwMDAwMDAwMH0.some_long_sig"
    expect(jwt.length).toBeGreaterThan(80)
    expect(shouldOfferMultilineEdit(jwt)).toBe(true)
  })

  it("returns false for empty string", () => {
    expect(shouldOfferMultilineEdit("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectLanguage — subset of cases relevant to the dialog's language picker
// ---------------------------------------------------------------------------

describe("detectLanguage (dialog context)", () => {
  it("returns json for a JSON config blob", () => {
    expect(detectLanguage('{"timeout": 30, "retries": 3}')).toBe("json")
  })

  it("returns yaml for a multi-key YAML block", () => {
    expect(detectLanguage("host: db\nport: 5432\nname: mydb")).toBe("yaml")
  })

  it("returns shell for a script with export", () => {
    expect(detectLanguage("export FOO=bar\nexport BAZ=qux")).toBe("shell")
  })

  it("returns plaintext for a certificate", () => {
    expect(detectLanguage("-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----")).toBe(
      "plaintext",
    )
  })

  it("returns plaintext as default fallback", () => {
    expect(detectLanguage("just a plain value")).toBe("plaintext")
  })
})
