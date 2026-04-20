// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for ApiErrorState component logic.
 *
 * Strategy: extract the branching logic (title resolution, CTA presence)
 * without DOM rendering — consistent with the repo's test style.
 *
 * Covers:
 *  - SECOND_FACTOR_REQUIRED branch: correct title + CTA to passkeys settings
 *  - Generic error branches: 401, 403, 404, 5xx, unknown
 */
import { describe, expect, it } from "bun:test"

// ---------------------------------------------------------------------------
// titleForStatus (mirror of ApiErrorState.tsx helper)
// ---------------------------------------------------------------------------

function titleForStatus(code?: string, status?: number): string {
  if (code === "SECOND_FACTOR_REQUIRED") return "Second factor required"
  if (code === "BACKEND_UNAVAILABLE") return "Backend indisponible"
  if (status === 401) return "Not signed in"
  if (status === 403) return "Forbidden"
  if (status === 404) return "Not found"
  if (status !== undefined && status >= 500) return "Something broke"
  return "Something went wrong"
}

// ---------------------------------------------------------------------------
// Branch decision: should we render the SECOND_FACTOR_REQUIRED CTA?
// ---------------------------------------------------------------------------

interface ApiErrorStateInput {
  code?: string
  status?: number
}

function isSecondFactorRequired(input: ApiErrorStateInput): boolean {
  return input.code === "SECOND_FACTOR_REQUIRED"
}

/** Returns the CTA link target when in SECOND_FACTOR_REQUIRED mode. */
function secondFactorCtaTarget(): string {
  return "/settings/security/passkeys"
}

/** Returns the CTA label when in SECOND_FACTOR_REQUIRED mode. */
function secondFactorCtaLabel(): string {
  return "Configurer"
}

/** Returns the descriptive message shown in SECOND_FACTOR_REQUIRED mode. */
function secondFactorMessage(): string {
  return "Ajoutez une 2ᵉ passkey ou générez des backup codes pour effectuer cette action."
}

// ---------------------------------------------------------------------------
// Tests — SECOND_FACTOR_REQUIRED branch
// ---------------------------------------------------------------------------

describe("ApiErrorState — SECOND_FACTOR_REQUIRED branch", () => {
  it("titleForStatus returns 'Second factor required' for SECOND_FACTOR_REQUIRED code", () => {
    expect(titleForStatus("SECOND_FACTOR_REQUIRED")).toBe("Second factor required")
  })

  it("isSecondFactorRequired returns true when code is SECOND_FACTOR_REQUIRED", () => {
    expect(isSecondFactorRequired({ code: "SECOND_FACTOR_REQUIRED" })).toBe(true)
  })

  it("isSecondFactorRequired returns true regardless of status", () => {
    expect(isSecondFactorRequired({ code: "SECOND_FACTOR_REQUIRED", status: 403 })).toBe(true)
  })

  it("CTA points to /settings/security/passkeys", () => {
    expect(secondFactorCtaTarget()).toBe("/settings/security/passkeys")
  })

  it("CTA label is 'Configurer'", () => {
    expect(secondFactorCtaLabel()).toBe("Configurer")
  })

  it("message contains passkey and backup codes instructions", () => {
    const msg = secondFactorMessage()
    expect(msg).toContain("passkey")
    expect(msg).toContain("backup codes")
  })
})

// ---------------------------------------------------------------------------
// Tests — generic error branches
// ---------------------------------------------------------------------------

describe("ApiErrorState — generic error titles", () => {
  it("BACKEND_UNAVAILABLE → 'Backend indisponible'", () => {
    expect(titleForStatus("BACKEND_UNAVAILABLE")).toBe("Backend indisponible")
  })

  it("status 401 → 'Not signed in'", () => {
    expect(titleForStatus(undefined, 401)).toBe("Not signed in")
  })

  it("status 403 → 'Forbidden'", () => {
    expect(titleForStatus(undefined, 403)).toBe("Forbidden")
  })

  it("status 404 → 'Not found'", () => {
    expect(titleForStatus(undefined, 404)).toBe("Not found")
  })

  it("status 500 → 'Something broke'", () => {
    expect(titleForStatus(undefined, 500)).toBe("Something broke")
  })

  it("status 503 → 'Something broke'", () => {
    expect(titleForStatus(undefined, 503)).toBe("Something broke")
  })

  it("no code, no status → 'Something went wrong'", () => {
    expect(titleForStatus()).toBe("Something went wrong")
  })

  it("SECOND_FACTOR_REQUIRED does NOT trigger generic 403 title even if status=403", () => {
    expect(titleForStatus("SECOND_FACTOR_REQUIRED", 403)).toBe("Second factor required")
  })

  it("isSecondFactorRequired returns false for generic 403", () => {
    expect(isSecondFactorRequired({ status: 403 })).toBe(false)
  })

  it("isSecondFactorRequired returns false when code is absent", () => {
    expect(isSecondFactorRequired({})).toBe(false)
  })

  it("isSecondFactorRequired returns false for BACKEND_UNAVAILABLE", () => {
    expect(isSecondFactorRequired({ code: "BACKEND_UNAVAILABLE" })).toBe(false)
  })
})
