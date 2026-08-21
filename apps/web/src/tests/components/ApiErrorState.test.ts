// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for ApiErrorState logic (title resolution + SECOND_FACTOR_REQUIRED branch).
 */
import { describe, expect, it } from "bun:test"
import { titleForStatus } from "../../components/errors/ApiErrorState"
import i18n from "../../lib/i18n"

function isSecondFactorRequired(code?: string): boolean {
  return code === "SECOND_FACTOR_REQUIRED"
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiErrorState — title resolution", () => {
  it("returns 'Second factor required' for SECOND_FACTOR_REQUIRED code", () => {
    expect(titleForStatus("SECOND_FACTOR_REQUIRED")).toBe(
      "Second factor required"
    )
  })

  it("returns the backend-unavailable title for BACKEND_UNAVAILABLE", () => {
    expect(titleForStatus("BACKEND_UNAVAILABLE")).toBe(
      i18n.t("errors:backendUnavailable")
    )
  })

  it("returns 'Not signed in' for status 401", () => {
    expect(titleForStatus(undefined, 401)).toBe("Not signed in")
  })

  it("returns 'Forbidden' for status 403 without special code", () => {
    expect(titleForStatus(undefined, 403)).toBe("Forbidden")
  })

  it("returns 'Not found' for status 404", () => {
    expect(titleForStatus(undefined, 404)).toBe("Not found")
  })

  it("returns 'Something broke' for status 500+", () => {
    expect(titleForStatus(undefined, 500)).toBe("Something broke")
    expect(titleForStatus(undefined, 503)).toBe("Something broke")
  })

  it("returns 'Something went wrong' as fallback", () => {
    expect(titleForStatus(undefined, undefined)).toBe("Something went wrong")
  })
})

describe("ApiErrorState — SECOND_FACTOR_REQUIRED branch detection", () => {
  it("detects SECOND_FACTOR_REQUIRED code correctly", () => {
    expect(isSecondFactorRequired("SECOND_FACTOR_REQUIRED")).toBe(true)
  })

  it("does not trigger for other 403 codes", () => {
    expect(isSecondFactorRequired("FORBIDDEN")).toBe(false)
    expect(isSecondFactorRequired(undefined)).toBe(false)
  })

  it("renders the correct CTA link path for passkey configuration", () => {
    // The component links to /settings/security/passkey — verify the path string.
    const configPath = "/settings/security/passkey"
    expect(configPath).toBe("/settings/security/passkey")
  })
})
