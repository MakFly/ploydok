// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #10 — Cleanup workspace + images anciennes auto
 *
 * Two assertions:
 *
 *   A) Workspace cleanup:
 *      After the first build the deploy handler enqueues a `cleanup.build` job
 *      (fire-and-forget, see deploy.ts:287).  The worker picks it up within
 *      2 s (worker loop tick).  We wait 5 s then verify that the build
 *      workspace directory no longer exists on disk.
 *      Directory: <PLOYDOK_BUILD_DIR>/<appId>/<buildId>
 *      Default PLOYDOK_BUILD_DIR: ~/.ploydok-dev/builds
 *
 *   B) Registry GC keep-last-3:
 *      After 5 additional deploys (builds #2–#6) the registry should retain
 *      at most 3 image tags for this app.  Verified via
 *      GET /apps/:id/registry-usage → { tags: number, bytes: number, diskPct: number }.
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *
 * Note: this spec runs 6 sequential builds and is inherently slow (~10 min on
 * a cold machine).  It is also infra-sensitive and may be flaky if BuildKit or
 * the registry are slow.  This is expected and documented here.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  API_URL,
  REAL_E2E,
  cleanupApp,
  createApp,
  loginViaApi,
  pollBuildStatus,
  triggerDeploy,
} from "./_harness"
import { pollBuildStatus2 } from "./_poll-build2"
import type { AuthContext, BuildRow } from "./_harness"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout (6 builds × ~60 s each + margin)
// ---------------------------------------------------------------------------

test.describe("DoD #10 — workspace + registry cleanup", () => {
  test.describe.configure({ timeout: 600_000 })

  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")

  let auth: AuthContext
  let appId = ""

  test.beforeAll(async () => {
    auth = await loginViaApi()
  })

  test.afterAll(async () => {
    if (appId) await cleanupApp(auth, appId)
  })

  // --------------------------------------------------------------------------
  // A) Workspace cleanup
  // --------------------------------------------------------------------------

  test("build workspace is removed after deploy completes", async () => {
    // 1. Create app — build #1 auto-enqueued.
    ;({ id: appId } = await createApp(auth, {
      name: `fixture-cleanup-${Date.now()}`,
      repoFullName: "MakFly/fixture-hello",
      branch: "main",
      buildMethod: "docker",
    }))

    const build1: BuildRow = await pollBuildStatus(auth, appId, {
      timeoutMs: 180_000,
    })
    const buildId1 = build1.id
    console.log(`[dod-11] build #1 id=${buildId1} succeeded`)

    // 2. Wait 5 s for the cleanup.build job to be processed (worker tick 2 s).
    console.log("[dod-11] waiting 5 s for cleanup.build job to run…")
    await new Promise<void>((r) => setTimeout(r, 5_000))

    // 3. Resolve build dir path (expand ~ via os.homedir()).
    const buildDirBase =
      process.env["PLOYDOK_BUILD_DIR"] ??
      join(homedir(), ".ploydok-dev", "builds")

    const workspaceDir = join(buildDirBase, appId, buildId1)
    const exists = existsSync(workspaceDir)

    console.log(
      `[dod-11] workspace dir: ${workspaceDir} — exists=${exists}`,
    )

    expect(
      exists,
      `workspace directory ${workspaceDir} should be removed by cleanup.build job`,
    ).toBe(false)
  })

  // --------------------------------------------------------------------------
  // B) Registry GC: at most 3 tags after 5 redeployments
  // --------------------------------------------------------------------------

  test("registry retains at most 3 image tags after 5 redeployments", async () => {
    // appId may already be set from test A (same beforeAll scope).
    // If not (e.g. test A was skipped), create a fresh app.
    if (!appId) {
      ;({ id: appId } = await createApp(auth, {
        name: `fixture-gc-${Date.now()}`,
        repoFullName: "MakFly/fixture-hello",
        branch: "main",
        buildMethod: "docker",
      }))

      await pollBuildStatus(auth, appId, { timeoutMs: 180_000 })
      console.log(`[dod-11] fresh app id=${appId} — build #1 succeeded`)
    }

    // Trigger 5 more deploys sequentially (builds #2 – #6).
    let prevBuildId = (
      await (async () => {
        const res = await fetch(`${API_URL}/apps/${appId}`, {
          headers: { cookie: auth.cookie },
        })
        const data = (await res.json()) as { builds: Array<BuildRow> }
        return data.builds[0]
      })()
    )?.id

    if (!prevBuildId) {
      throw new Error("dod-11: could not determine current build id before redeploys")
    }

    for (let i = 2; i <= 6; i++) {
      await triggerDeploy(auth, appId)
      const newBuild = await pollBuildStatus2(auth, appId, prevBuildId, {
        timeoutMs: 180_000,
        intervalMs: 2_000,
      })
      prevBuildId = newBuild.id
      console.log(`[dod-11] build #${i} id=${prevBuildId} succeeded`)
    }

    // Query registry usage.
    const usageRes = await fetch(`${API_URL}/apps/${appId}/registry-usage`, {
      headers: {
        cookie: auth.cookie,
        "x-csrf-token": auth.csrfToken,
      },
    })

    expect(
      usageRes.ok,
      `GET /apps/${appId}/registry-usage should return 200 (got ${usageRes.status})`,
    ).toBe(true)

    // Shape: { tags: number, bytes: number, diskPct: number }
    const usage = (await usageRes.json()) as {
      tags: number
      bytes: number
      diskPct: number
    }

    console.log(
      `[dod-11] registry usage — tags=${usage.tags}, bytes=${usage.bytes}, diskPct=${usage.diskPct}`,
    )

    expect(
      usage.tags,
      "registry must keep at most 3 image tags per app (GC keep-last-3)",
    ).toBeLessThanOrEqual(3)
  })

  // --------------------------------------------------------------------------
  // C) Cascade delete: DELETE /apps/:id wipes container, registry, build dir,
  //    Caddy route, and DB row (Coolify-style).
  // --------------------------------------------------------------------------

  test("DELETE /apps/:id cascades to registry, build dir, and DB row", async () => {
    if (!appId) {
      throw new Error("dod-11.C: appId must be set by previous tests")
    }

    // Snapshot the build dir so we can assert it's gone after cascade.
    const buildDirBase =
      process.env["PLOYDOK_BUILD_DIR"] ??
      join(homedir(), ".ploydok-dev", "builds")
    const appBuildDir = join(buildDirBase, appId)

    // Trigger cascade delete with all flags = true (the default).
    const delRes = await fetch(`${API_URL}/apps/${appId}`, {
      method: "DELETE",
      headers: {
        cookie: auth.cookie,
        "x-csrf-token": auth.csrfToken,
      },
    })
    expect(delRes.status).toBe(202)
    const delBody = (await delRes.json()) as { ok: boolean; status: string }
    expect(delBody.ok).toBe(true)
    expect(delBody.status).toBe("deleting")

    // Wait up to 30 s for the worker to process the cascade (worker tick 2 s,
    // GC + caddy + rm -rf + DB delete usually finishes in <10 s on this fixture).
    const deadline = Date.now() + 30_000
    let stillFound = true
    while (Date.now() < deadline) {
      const r = await fetch(`${API_URL}/apps/${appId}`, {
        headers: { cookie: auth.cookie },
      })
      if (r.status === 404) {
        stillFound = false
        break
      }
      await new Promise<void>((res) => setTimeout(res, 1_000))
    }
    expect(stillFound, "GET /apps/:id should 404 after cascade delete").toBe(false)

    // Build dir on disk should be wiped.
    expect(
      existsSync(appBuildDir),
      `build dir ${appBuildDir} should be removed by cascade`,
    ).toBe(false)

    // Registry catalog should not list this repo anymore. We hit the registry
    // directly because the API endpoint is gated by app ownership (404 now).
    const catalogRes = await fetch("http://127.0.0.1:5000/v2/_catalog")
    if (catalogRes.ok) {
      const catalog = (await catalogRes.json()) as { repositories?: string[] }
      const repo = `app-${appId.toLowerCase()}`
      expect(
        catalog.repositories ?? [],
        `registry catalog should not list ${repo} after cascade`,
      ).not.toContain(repo)
    }

    // Mark appId as gone so afterAll teardown doesn't try to re-delete it.
    appId = ""
  })
})
