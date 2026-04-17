// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for DeployButton logic.
 * Validates the disabled/label state machine and navigation behavior.
 */
import { describe, expect, it } from "bun:test"

// ---------------------------------------------------------------------------
// Pure logic extracted from DeployButton behavior
// ---------------------------------------------------------------------------

interface DeployState {
  isActive: boolean
  isPending: boolean
}

function getButtonLabel(state: DeployState): string {
  return state.isActive || state.isPending ? "Deploying…" : "Deploy"
}

function isButtonDisabled(state: DeployState): boolean {
  return state.isActive || state.isPending
}

function buildDeployPayload(opts: {
  rebuild?: boolean
  noCache?: boolean
}): Record<string, boolean> | undefined {
  if (opts.rebuild || opts.noCache) return opts as Record<string, boolean>
  return undefined
}

function getPostDeployRoute(appId: string): string {
  // TODO(wave-2): update to /apps/$id/deployments once Wave 2 renames the route
  return `/apps/${appId}/builds`
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeployButton — label state", () => {
  it('shows "Deploy" when idle', () => {
    expect(getButtonLabel({ isActive: false, isPending: false })).toBe("Deploy")
  })

  it('shows "Deploying…" when isActive (SSE build in progress)', () => {
    expect(getButtonLabel({ isActive: true, isPending: false })).toBe("Deploying…")
  })

  it('shows "Deploying…" when mutation is pending', () => {
    expect(getButtonLabel({ isActive: false, isPending: true })).toBe("Deploying…")
  })
})

describe("DeployButton — disabled state", () => {
  it("is enabled when idle", () => {
    expect(isButtonDisabled({ isActive: false, isPending: false })).toBe(false)
  })

  it("is disabled when isActive", () => {
    expect(isButtonDisabled({ isActive: true, isPending: false })).toBe(true)
  })

  it("is disabled when pending", () => {
    expect(isButtonDisabled({ isActive: false, isPending: true })).toBe(true)
  })
})

describe("DeployButton — deploy options payload", () => {
  it("returns undefined for normal deploy", () => {
    expect(buildDeployPayload({})).toBeUndefined()
  })

  it("returns payload with rebuild=true for redeploy", () => {
    const payload = buildDeployPayload({ rebuild: true })
    expect(payload?.rebuild).toBe(true)
  })

  it("returns payload with rebuild + noCache for cache-bust", () => {
    const payload = buildDeployPayload({ rebuild: true, noCache: true })
    expect(payload?.rebuild).toBe(true)
    expect(payload?.noCache).toBe(true)
  })
})

describe("DeployButton — post-deploy navigation", () => {
  it("navigates to builds tab after deploy", () => {
    expect(getPostDeployRoute("app-123")).toBe("/apps/app-123/builds")
  })
})
