// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #6 — Custom healthcheck overrides
 *
 * Validates that the healthcheck configuration is respected by the deploy
 * pipeline using the `ploydok/fixture-slow-boot` repo (app sleeps 8 s before
 * binding the port).
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *
 * Test A — with permissive overrides: build must succeed and / must return 200.
 * Test B — with tight overrides (window = 2 s): build must fail the healthcheck.
 *
 * Why NOT relying on API defaults for Test B:
 *   API defaults are retries=6, intervalS=5, startPeriodS=0 — that gives a
 *   30 s window which trivially covers the 8 s sleep. Test B therefore uses
 *   explicit tight overrides (retries=2, intervalS=1, startPeriodS=0) to force
 *   a 2 s window and guarantee a healthcheck failure.
 */

import { expect, test } from "@playwright/test"
import type { AuthContext } from "../dod/_harness"
import {
  REAL_E2E,
  cleanupApp,
  createApp,
  fetchViaProxy,
  loginViaApi,
  pollBuildStatus,
} from "../dod/_harness"

const FIXTURE_SLOW_BOOT = "ploydok/fixture-slow-boot"
const FIXTURE_RESPONSE_TEXT = "hello from ploydok (slow-boot"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout
// ---------------------------------------------------------------------------

test.describe("DoD #6 — healthcheck custom overrides", () => {
  test.describe.configure({ timeout: 300_000 })

  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")

  let auth: AuthContext
  let appIdA = ""
  let appIdB = ""

  test.beforeAll(async () => {
    auth = await loginViaApi()
  })

  test.afterAll(async () => {
    if (appIdA) await cleanupApp(auth, appIdA)
    if (appIdB) await cleanupApp(auth, appIdB)
  })

  // --------------------------------------------------------------------------
  // Test A — permissive overrides: deploy must succeed
  // --------------------------------------------------------------------------

  test("Test A — permissive healthcheck → deploy succeeds, / returns 200", async () => {
    // startPeriodS=5 gives the app 5 s grace + 12 retries × 2 s = 29 s window.
    // An 8 s boot delay fits comfortably.
    const { id, slug } = await createApp(auth, {
      name: `fixture-slowboot-ok-${Date.now()}`,
      repoFullName: FIXTURE_SLOW_BOOT,
      branch: "main",
      buildMethod: "docker",
      healthcheck: {
        path: "/",
        startPeriodS: 5,
        intervalS: 2,
        retries: 12,
        timeoutS: 3,
      },
    })
    appIdA = id

    await test.step("wait for build to succeed", async () => {
      await pollBuildStatus(auth, appIdA, { timeoutMs: 180_000 })
    })

    await test.step("verify live response via proxy", async () => {
      const res = await fetchViaProxy(slug, "/")
      expect(res.status, `/${slug} should return 200`).toBe(200)
      const body = await res.text()
      expect(body, "body should identify as slow-boot fixture").toContain(
        FIXTURE_RESPONSE_TEXT,
      )
    })
  })

  // --------------------------------------------------------------------------
  // Test B — tight overrides: healthcheck must fail
  //
  // We pass retries=2, intervalS=1, startPeriodS=0 → effective window = 2 s.
  // The fixture sleeps 8 s before binding, so Docker's healthcheck will
  // exhaust all retries before the app is ready and mark it "failed".
  // --------------------------------------------------------------------------

  test("Test B — tight healthcheck (2 s window) → build fails", async () => {
    const { id } = await createApp(auth, {
      name: `fixture-slowboot-fail-${Date.now()}`,
      repoFullName: FIXTURE_SLOW_BOOT,
      branch: "main",
      buildMethod: "docker",
      // Tight window: retries=2 × intervalS=1 + startPeriodS=0 = 2 s total.
      // The 8 s boot delay will exhaust all retries.
      healthcheck: {
        path: "/",
        retries: 2,
        intervalS: 1,
        startPeriodS: 0,
        timeoutS: 1,
      },
    })
    appIdB = id

    await test.step("poll until build fails", async () => {
      let caughtError: Error | null = null
      try {
        await pollBuildStatus(auth, appIdB, { timeoutMs: 120_000 })
      } catch (err) {
        caughtError = err instanceof Error ? err : new Error(String(err))
      }

      // pollBuildStatus throws when build status === "failed".
      // If it did NOT throw the build unexpectedly succeeded — fail the test.
      expect(
        caughtError,
        "build with tight healthcheck should fail, but it succeeded",
      ).not.toBeNull()

      // Confirm the error message mentions the expected failure signal.
      // pollBuildStatus throws with "build failed" in the message.
      expect(
        caughtError?.message ?? "",
        "error should indicate a build failure",
      ).toMatch(/failed/i)
    })
  })
})
