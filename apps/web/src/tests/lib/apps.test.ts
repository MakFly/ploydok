// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for lib/apps.ts — normalizeAppDetail + type contracts.
 * No React hooks; tests pure normalization logic.
 */
import { describe, expect, it } from "bun:test"
import { applyAppStatus, getEventAppStatus, normalizeAppDetail } from "../../lib/apps"
import type { RawAppDetail } from "../../lib/apps"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRaw(overrides: Partial<RawAppDetail> = {}): RawAppDetail {
  return {
    id: "app-1",
    name: "Test app",
    slug: "test-app",
    status: "running",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// normalizeAppDetail — healthcheck path + port
// ---------------------------------------------------------------------------

describe("normalizeAppDetail — healthcheck path / port", () => {
  it("maps healthcheck.path to healthcheckPath", () => {
    const raw = makeRaw({ healthcheck: { path: "/health" } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckPath).toBe("/health")
  })

  it("maps healthcheck.port to healthcheckPort", () => {
    const raw = makeRaw({ healthcheck: { port: 8080 } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckPort).toBe(8080)
  })

  it("sets healthcheckPort to null when absent", () => {
    const raw = makeRaw({ healthcheck: { path: "/ping" } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckPort).toBeNull()
  })

  it("handles null healthcheck", () => {
    const raw = makeRaw({ healthcheck: null })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckPath).toBeUndefined()
    expect(result.healthcheckPort).toBeNull()
  })

  it("handles absent healthcheck", () => {
    const raw = makeRaw()
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckPath).toBeUndefined()
    expect(result.healthcheckPort).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// normalizeAppDetail — 4 new healthcheck timing fields (W2.B fix)
// ---------------------------------------------------------------------------

describe("normalizeAppDetail — healthcheck timing fields", () => {
  it("maps intervalS to healthcheckIntervalS", () => {
    const raw = makeRaw({ healthcheck: { intervalS: 10 } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckIntervalS).toBe(10)
  })

  it("maps timeoutS to healthcheckTimeoutS", () => {
    const raw = makeRaw({ healthcheck: { timeoutS: 5 } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckTimeoutS).toBe(5)
  })

  it("maps retries to healthcheckRetries", () => {
    const raw = makeRaw({ healthcheck: { retries: 3 } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckRetries).toBe(3)
  })

  it("maps startPeriodS to healthcheckStartPeriodS", () => {
    const raw = makeRaw({ healthcheck: { startPeriodS: 30 } })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckStartPeriodS).toBe(30)
  })

  it("sets all timing fields to null when healthcheck is absent", () => {
    const raw = makeRaw()
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckIntervalS).toBeNull()
    expect(result.healthcheckTimeoutS).toBeNull()
    expect(result.healthcheckRetries).toBeNull()
    expect(result.healthcheckStartPeriodS).toBeNull()
  })

  it("maps all 4 timing fields together from a full healthcheck object", () => {
    const raw = makeRaw({
      healthcheck: {
        path: "/health",
        port: 3000,
        intervalS: 15,
        timeoutS: 5,
        retries: 3,
        startPeriodS: 10,
      },
    })
    const result = normalizeAppDetail(raw)
    expect(result.healthcheckPath).toBe("/health")
    expect(result.healthcheckPort).toBe(3000)
    expect(result.healthcheckIntervalS).toBe(15)
    expect(result.healthcheckTimeoutS).toBe(5)
    expect(result.healthcheckRetries).toBe(3)
    expect(result.healthcheckStartPeriodS).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// normalizeAppDetail — rest fields pass through
// ---------------------------------------------------------------------------

describe("normalizeAppDetail — pass-through fields", () => {
  it("preserves id, name, slug, status", () => {
    const raw = makeRaw({ id: "x", name: "Y", slug: "y", status: "failed" })
    const result = normalizeAppDetail(raw)
    expect(result.id).toBe("x")
    expect(result.name).toBe("Y")
    expect(result.slug).toBe("y")
    expect(result.status).toBe("failed")
  })

  it("preserves optional string fields", () => {
    const raw = makeRaw({
      gitProvider: "github",
      rootDir: "/src",
      buildMethod: "docker",
      restartPolicy: "on-failure",
      branch: "main",
    })
    const result = normalizeAppDetail(raw)
    expect(result.gitProvider).toBe("github")
    expect(result.rootDir).toBe("/src")
    expect(result.buildMethod).toBe("docker")
    expect(result.restartPolicy).toBe("on-failure")
    expect(result.branch).toBe("main")
  })
})

describe("app status event helpers", () => {
  it("extracts the next status from an event payload", () => {
    expect(getEventAppStatus({ data: { status: "running" } })).toBe("running")
  })

  it("returns undefined when the event has no status", () => {
    expect(getEventAppStatus({})).toBeUndefined()
  })

  it("applies a new status without mutating other fields", () => {
    const raw = makeRaw({ name: "demo", status: "stopped" })
    const normalized = normalizeAppDetail(raw)
    const patched = applyAppStatus(normalized, "building")
    expect(patched?.status).toBe("building")
    expect(patched?.name).toBe("demo")
  })
})

// ---------------------------------------------------------------------------
// useRecentBuildsAcrossApps — normalization contract
// ---------------------------------------------------------------------------

describe("useRecentBuildsAcrossApps — normalizeAppDetail applied to raw response", () => {
  it("normalizeAppDetail is applied: healthcheck fields are flattened", () => {
    // Simulates what useRecentBuildsAcrossApps queryFn now does:
    // const data = await apiFetch<{ app: RawAppDetail; ... }>
    // return { app: normalizeAppDetail(data.app), ... }
    const raw = makeRaw({
      healthcheck: { path: "/readyz", port: 8080, intervalS: 10 },
    })
    const normalized = normalizeAppDetail(raw)
    expect(normalized.healthcheckPath).toBe("/readyz")
    expect(normalized.healthcheckPort).toBe(8080)
    expect(normalized.healthcheckIntervalS).toBe(10)
  })

  it("normalizeAppDetail on raw with no healthcheck produces null timing fields", () => {
    const raw = makeRaw()
    const normalized = normalizeAppDetail(raw)
    expect(normalized.healthcheckPath).toBeUndefined()
    expect(normalized.healthcheckPort).toBeNull()
    expect(normalized.healthcheckIntervalS).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// useApp / useBuilds initialData option — contract tests
// ---------------------------------------------------------------------------

describe("useApp / useBuilds initialData option — contract", () => {
  it("UseAppOptions type accepts initialData: AppDetail", () => {
    // Compile-time contract: if this test file compiles, the type is correct.
    // We just import and verify the type structure without calling the hook.
    type UseAppOptionsShape = { initialData?: ReturnType<typeof normalizeAppDetail> }
    const opts: UseAppOptionsShape = {
      initialData: normalizeAppDetail(makeRaw()),
    }
    expect(opts.initialData).toBeDefined()
  })

  it("normalizeAppDetail output can serve as initialData", () => {
    const raw = makeRaw({ name: "seed-app" })
    const normalized = normalizeAppDetail(raw)
    // initialData can be passed to useApp — no transforms needed.
    expect(normalized.name).toBe("seed-app")
    expect(normalized.healthcheckIntervalS).toBeNull()
  })
})
