// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #4 — Build cache effectiveness
 *
 * Asserts that the 2nd build of a Docker multi-stage app completes in less
 * than 40 % of the time taken by the 1st (cold) build.
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *
 * Strategy for disambiguating build #1 vs build #2:
 *   After the 1st build is confirmed "succeeded" (via pollBuildStatus), we
 *   capture its id. We then call triggerDeploy which enqueues build #2.
 *   A local poller waits until builds[0].id differs from build1Id (the API
 *   returns builds newest-first), then waits until that new build reaches
 *   "succeeded". This avoids the race where pollBuildStatus would immediately
 *   see the already-succeeded build #1 again.
 */

import { expect, test } from "@playwright/test"
import type { AuthContext } from "../dod/_harness"
import {
  REAL_E2E,
  cleanupApp,
  chrono,
  createApp,
  loginViaApi,
  pollBuildStatus,
  triggerDeploy,
} from "../dod/_harness"
import { pollBuildStatus2 } from "../dod/_poll-build2"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout (2 cold+warm builds may take up to 10 min total)
// ---------------------------------------------------------------------------

test.describe("DoD #4 — build cache", () => {
  test.describe.configure({ timeout: 600_000 })

  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")

  // Shared across the single test so afterAll can clean up.
  let auth: AuthContext
  let appId = ""

  test.beforeAll(async () => {
    auth = await loginViaApi()
  })

  test.afterAll(async () => {
    if (appId) await cleanupApp(auth, appId)
  })

  // --------------------------------------------------------------------------
  // Main test
  // --------------------------------------------------------------------------

  test("2nd build completes in < 40 % of 1st build time", async () => {
    // 1. Create app — POST /apps auto-enqueues build #1.
    const appName = `fixture-cache-${Date.now()}`
    ;({ id: appId } = await createApp(auth, {
      name: appName,
      repoFullName: "ploydok/fixture-nextjs",
      branch: "main",
      buildMethod: "docker",
    }))

    // 2. Chrono build #1 (cold — no cache layers yet).
    const { result: build1, durationMs: t1 } = await chrono(async () => {
      return pollBuildStatus(auth, appId, { timeoutMs: 300_000 })
    })

    const build1Id = build1.id
    console.log(`[dod-05] Build #1 id=${build1Id} — cold duration ${t1.toFixed(0)} ms`)

    // 3. Trigger build #2.
    await triggerDeploy(auth, appId)

    // 4. Chrono build #2 (warm — cache should kick in).
    //    We poll until builds[0].id !== build1Id, then wait for "succeeded".
    //    pollBuildStatus always inspects builds[0] (newest first), so once the
    //    new build appears at the head of the list we know it's build #2.
    const { result: build2, durationMs: t2 } = await chrono(async () => {
      return pollBuildStatus2(auth, appId, build1Id, {
        timeoutMs: 300_000,
        intervalMs: 2_000,
      })
    })

    console.log(
      `[dod-05] Build #2 id=${build2.id} — warm duration ${t2.toFixed(0)} ms`,
    )

    // 5. Assert cache effectiveness.
    const ratio = t2 / t1
    console.log(
      `[dod-05] cache ratio = ${ratio.toFixed(2)} (t1=${t1.toFixed(0)} ms, t2=${t2.toFixed(0)} ms)`,
    )

    expect(ratio, "2nd build must be < 40 % of 1st").toBeLessThan(0.4)
  })
})
