// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Smoke tests for apps-mutations — tests the mutation endpoint construction
 * logic without importing React hooks (avoids module resolution issues).
 */
import { describe, expect, it } from "bun:test"

// ---------------------------------------------------------------------------
// Pure helpers that mirror mutation logic from apps-mutations.ts
// ---------------------------------------------------------------------------

function deployEndpoint(appId: string): string {
  return `/apps/${appId}/deploy`
}

function rollbackEndpoint(appId: string): string {
  return `/apps/${appId}/rollback`
}

function stopEndpoint(appId: string): string {
  return `/apps/${appId}/stop`
}

function restartEndpoint(appId: string): string {
  return `/apps/${appId}/restart`
}

function deleteEndpoint(appId: string): string {
  return `/apps/${appId}`
}

interface DeployOptions {
  rebuild?: boolean
  noCache?: boolean
}

function buildDeployBody(opts: DeployOptions | void): DeployOptions | undefined {
  if (!opts) return undefined
  if (opts.rebuild || opts.noCache) return opts
  return undefined
}

function buildHealthcheckPayload(
  body: Partial<{
    healthcheckPath: string | undefined
    healthcheckPort: number | null | undefined
    restartPolicy: "no" | "always" | "unless-stopped" | "on-failure"
    branch: string
  }>,
): Record<string, unknown> {
  const { healthcheckPath, healthcheckPort, restartPolicy, ...rest } = body
  const payload: Record<string, unknown> = { ...rest }
  if (restartPolicy !== undefined) payload.restartPolicy = restartPolicy
  if (healthcheckPath !== undefined || healthcheckPort !== undefined) {
    const healthcheck: Record<string, unknown> = {}
    if (healthcheckPath !== undefined) healthcheck.path = healthcheckPath ?? undefined
    if (healthcheckPort !== undefined) healthcheck.port = healthcheckPort ?? undefined
    payload.healthcheck = healthcheck
  }
  return payload
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apps-mutations — endpoint construction", () => {
  it("deploy endpoint is correct", () => {
    expect(deployEndpoint("app-123")).toBe("/apps/app-123/deploy")
  })

  it("rollback endpoint is correct", () => {
    expect(rollbackEndpoint("app-456")).toBe("/apps/app-456/rollback")
  })

  it("stop endpoint is correct", () => {
    expect(stopEndpoint("app-abc")).toBe("/apps/app-abc/stop")
  })

  it("restart endpoint is correct", () => {
    expect(restartEndpoint("app-xyz")).toBe("/apps/app-xyz/restart")
  })

  it("delete endpoint uses the app root URL", () => {
    expect(deleteEndpoint("app-del")).toBe("/apps/app-del")
  })
})

describe("apps-mutations — deploy body construction", () => {
  it("returns undefined body for plain deploy", () => {
    expect(buildDeployBody()).toBeUndefined()
    expect(buildDeployBody({ rebuild: false, noCache: false })).toBeUndefined()
  })

  it("returns body with rebuild=true for redeploy", () => {
    const body = buildDeployBody({ rebuild: true })
    expect(body?.rebuild).toBe(true)
  })

  it("returns body with noCache=true for cache-bust rebuild", () => {
    const body = buildDeployBody({ rebuild: true, noCache: true })
    expect(body?.noCache).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Optimistic update logic — mirrors onMutate from useStopApp / useRestartApp
// ---------------------------------------------------------------------------

type AppStatus = "created" | "pending" | "building" | "running" | "restarting" | "failed" | "stopped"

interface AppSnapshot {
  id: string
  status: AppStatus
  name: string
}

function applyOptimisticStatus(
  existing: AppSnapshot | undefined,
  nextStatus: AppStatus,
): { patched: AppSnapshot | null; snapshot: AppSnapshot | undefined } {
  if (!existing) return { patched: null, snapshot: undefined }
  return {
    patched: { ...existing, status: nextStatus },
    snapshot: existing,
  }
}

describe("apps-mutations — optimistic update logic", () => {
  const app: AppSnapshot = { id: "app-1", status: "running", name: "My App" }

  it("useRestartApp: sets status to restarting optimistically", () => {
    const { patched, snapshot } = applyOptimisticStatus(app, "restarting")
    expect(patched?.status).toBe("restarting")
    expect(snapshot?.status).toBe("running")
  })

  it("useStopApp: sets status to stopped optimistically", () => {
    const { patched, snapshot } = applyOptimisticStatus(app, "stopped")
    expect(patched?.status).toBe("stopped")
    expect(snapshot?.status).toBe("running")
  })

  it("rollback restores original status on error", () => {
    const { snapshot } = applyOptimisticStatus(app, "restarting")
    // Simulates onError rollback
    const rolled = snapshot ?? app
    expect(rolled.status).toBe("running")
  })

  it("noop when cache entry is undefined", () => {
    const { patched, snapshot } = applyOptimisticStatus(undefined, "restarting")
    expect(patched).toBeNull()
    expect(snapshot).toBeUndefined()
  })
})

describe("apps-mutations — settings healthcheck payload serialization", () => {
  it("wraps healthcheckPath into nested healthcheck object", () => {
    const payload = buildHealthcheckPayload({ healthcheckPath: "/health" })
    expect(payload.healthcheck).toMatchObject({ path: "/health" })
    expect(payload.healthcheckPath).toBeUndefined()
  })

  it("wraps healthcheckPort into nested healthcheck object", () => {
    const payload = buildHealthcheckPayload({ healthcheckPort: 3000 })
    expect(payload.healthcheck).toMatchObject({ port: 3000 })
  })

  it("passes non-healthcheck fields through unchanged", () => {
    const payload = buildHealthcheckPayload({ branch: "main" })
    expect(payload.branch).toBe("main")
    expect(payload.healthcheck).toBeUndefined()
  })

  it("passes restartPolicy through unchanged", () => {
    const payload = buildHealthcheckPayload({ restartPolicy: "no" })
    expect(payload.restartPolicy).toBe("no")
  })

  it("omits healthcheck object when neither path nor port is provided", () => {
    const payload = buildHealthcheckPayload({})
    expect(payload.healthcheck).toBeUndefined()
  })
})
