// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Smoke tests for apps-env lib — tests endpoint construction and type shapes
 * without importing React hooks.
 */
import { describe, expect, it } from "bun:test"
import { envVarsQueryKey } from "../../lib/apps-env"

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

describe("envVarsQueryKey", () => {
  it("produces the expected tuple", () => {
    expect(envVarsQueryKey("app-123")).toEqual(["apps", "app-123", "env"])
  })

  it("is scoped per app ID", () => {
    const k1 = envVarsQueryKey("aaa")
    const k2 = envVarsQueryKey("bbb")
    expect(k1).not.toEqual(k2)
  })
})

// ---------------------------------------------------------------------------
// Endpoint construction (mirrors useEnvVars / useUpdateEnvVars logic)
// ---------------------------------------------------------------------------

function getEnvEndpoint(appId: string): string {
  return `/apps/${appId}/env`
}

function patchEnvEndpoint(appId: string): string {
  return `/apps/${appId}/env`
}

describe("apps-env — endpoint construction", () => {
  it("GET endpoint is correct", () => {
    expect(getEnvEndpoint("app-abc")).toBe("/apps/app-abc/env")
  })

  it("PATCH endpoint is correct", () => {
    expect(patchEnvEndpoint("app-xyz")).toBe("/apps/app-xyz/env")
  })
})

// ---------------------------------------------------------------------------
// Patch body shape validation (mirrors what useUpdateEnvVars sends)
// ---------------------------------------------------------------------------

interface EnvVarPatch {
  key: string
  value: string
  secret: boolean
}

function buildPatchBody(vars: EnvVarPatch[]): { vars: EnvVarPatch[] } {
  return { vars }
}

describe("apps-env — patch body", () => {
  it("wraps vars in an object", () => {
    const vars: EnvVarPatch[] = [{ key: "FOO", value: "bar", secret: false }]
    const body = buildPatchBody(vars)
    expect(body).toEqual({ vars })
  })

  it("handles empty var list (clear all)", () => {
    const body = buildPatchBody([])
    expect(body).toEqual({ vars: [] })
  })

  it("secret flag defaults propagate correctly", () => {
    const vars: EnvVarPatch[] = [
      { key: "PLAIN", value: "val", secret: false },
      { key: "HIDDEN", value: "secret", secret: true },
    ]
    const body = buildPatchBody(vars)
    expect(body.vars[0]!.secret).toBe(false)
    expect(body.vars[1]!.secret).toBe(true)
  })
})
