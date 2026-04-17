// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #5 — Zero-downtime redeploy under traffic
 *
 * Asserts that a blue-green swap during a live redeploy produces 0 × 5xx
 * responses when measured with ApacheBench (or its JS fallback).
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *
 * ab parameters retained:
 *   -t 60   (duration mode, 60 seconds of load — covers the full swap window)
 *   -c 10   (10 concurrent workers)
 * The JS fallback replicates the same duration + concurrency.
 */

import { expect, test } from "@playwright/test"
import {
  CADDY_HTTP_PORT,
  DOMAIN_BASE,
  REAL_E2E,
  cleanupApp,
  createApp,
  fetchViaProxy,
  loginViaApi,
  pollBuildStatus,
  runAb,
  triggerDeploy,
} from "../dod/_harness"
import { pollBuildStatus2 } from "../dod/_poll-build2"
import type { AuthContext } from "../dod/_harness"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout
// ---------------------------------------------------------------------------

test.describe("DoD #5 — zero-downtime redeploy", () => {
  test.describe.configure({ timeout: 300_000 })

  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")

  let auth: AuthContext
  let appId = ""
  let slug = ""

  test.beforeAll(async () => {
    auth = await loginViaApi()
  })

  test.afterAll(async () => {
    if (appId) await cleanupApp(auth, appId)
  })

  // --------------------------------------------------------------------------

  test("0× 5xx responses during blue-green swap under 60 s load", async () => {
    // 1. Create app and wait for build #1 to succeed.
    ;({ id: appId, slug } = await createApp(auth, {
      name: `fixture-zdt-${Date.now()}`,
      repoFullName: "ploydok/fixture-nextjs",
      branch: "main",
      buildMethod: "docker",
    }))

    const build1 = await pollBuildStatus(auth, appId, { timeoutMs: 180_000 })
    const build1Id = build1.id
    console.log(`[dod-06] Build #1 id=${build1Id} — app is live`)

    // 2. Smoke check before starting load.
    const baseUrl = `http://${slug}.${DOMAIN_BASE}:${CADDY_HTTP_PORT}/`
    const smokeRes = await fetchViaProxy(slug, "/")
    expect(smokeRes.status, `smoke check ${baseUrl} should return 200`).toBe(200)

    // 3. Run load + blue-green swap concurrently.
    const [abResult] = await Promise.all([
      // 3a. ApacheBench for 60s at 10 concurrent workers.
      runAb(baseUrl, { duration: "60", concurrency: 10 }),

      // 3b. Trigger redeploy and wait for build #2 to succeed.
      (async () => {
        await triggerDeploy(auth, appId)
        const build2 = await pollBuildStatus2(auth, appId, build1Id, {
          timeoutMs: 240_000,
          intervalMs: 2_000,
        })
        console.log(`[dod-06] Build #2 id=${build2.id} — swap complete`)
      })(),
    ])

    // 4. Assertions.
    console.log(
      `[dod-06] ab summary — total=${abResult.totalRequests}, non2xx=${abResult.non2xx}, rps=${abResult.rps.toFixed(1)}`,
    )
    console.log(`[dod-06] ab stdout:\n${abResult.stdout}`)

    expect(abResult.non2xx, "0× 5xx during blue-green swap").toBe(0)
    expect(
      abResult.totalRequests,
      "ab must have fired at least 100 requests",
    ).toBeGreaterThan(100)
  })
})
