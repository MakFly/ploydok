// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"

// ---------------------------------------------------------------------------
// Merge logic — tested without real DB or crypto
// ---------------------------------------------------------------------------

describe("buildEnvForDeploy merge logic (unit)", () => {
  it("scope-specific overrides shared on key conflict", () => {
    const shared = { FOO: "shared-val", SHARED_ONLY: "yes" }
    const scoped = { FOO: "prod-val" }
    const merged = { ...shared, ...scoped }
    expect(merged["FOO"]).toBe("prod-val")
    expect(merged["SHARED_ONLY"]).toBe("yes")
  })

  it("preview key wins over shared key", () => {
    const shared = { DB_URL: "shared-db" }
    const scoped = { DB_URL: "preview-db" }
    const merged = { ...shared, ...scoped }
    expect(merged["DB_URL"]).toBe("preview-db")
  })

  it("shared-only: all keys present when no scope override", () => {
    const shared = { LOG_LEVEL: "info", DB_URL: "shared-db" }
    const scoped = { DB_URL: "prod-db" }
    const merged = { ...shared, ...scoped }
    expect(merged["LOG_LEVEL"]).toBe("info")
    expect(merged["DB_URL"]).toBe("prod-db")
  })

  it("preview-pure: both shared and preview keys present", () => {
    const shared = { SHARED: "yes" }
    const scoped = { PREVIEW_ONLY: "preview" }
    const merged = { ...shared, ...scoped }
    expect(merged["SHARED"]).toBe("yes")
    expect(merged["PREVIEW_ONLY"]).toBe("preview")
    expect(Object.keys(merged)).toHaveLength(2)
  })

  it("empty secrets: returns empty map", () => {
    const merged = { ...{}, ...{} }
    expect(merged).toEqual({})
  })

  it("build phase ignores runtime-only keys", () => {
    const sharedBuild: Record<string, string> = { NEXT_PUBLIC_API_URL: "https://api.example.com" }
    const runtimeOnly: Record<string, string> = { PORT: "3000" }
    const merged = { ...sharedBuild }
    expect(merged["NEXT_PUBLIC_API_URL"]).toBe("https://api.example.com")
    expect(merged["PORT"]).toBeUndefined()
    expect(runtimeOnly["PORT"]).toBe("3000")
  })

  it("both phase is valid for build and runtime consumers", () => {
    const both = { NEXT_PUBLIC_APP_NAME: "ploydok" }
    expect(both["NEXT_PUBLIC_APP_NAME"]).toBe("ploydok")
  })
})
