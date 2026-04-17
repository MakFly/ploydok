// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #8 — Rollback completes in < 10 s
 *
 * Scenario:
 *   1. Build #1 (fixture-nextjs) — page renders `build: <buildId>`.
 *   2. Trigger deploy → build #2 — Caddy swaps to new container.
 *   3. Rollback → expect Caddy to serve build #1 again within 10 s.
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *
 * Note on "swap detection": we poll fetchViaProxy and check the raw HTML for
 * the `data-testid="build-id"` paragraph.  We look for the literal string
 * `build: <buildId1>` rather than parsing the DOM to keep this test free of a
 * browser context dependency.
 */

import { expect, test } from "@playwright/test"
import type { AuthContext, BuildRow } from "./_harness"
import {
  API_URL,
  REAL_E2E,
  chrono,
  cleanupApp,
  createApp,
  fetchViaProxy,
  loginViaApi,
  pollBuildStatus,
  triggerDeploy,
  triggerRollback,
} from "./_harness"
import { pollBuildStatus2 } from "./_poll-build2"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout
// ---------------------------------------------------------------------------

test.describe("DoD #8 — rollback < 10s", () => {
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

  test("rollback swaps Caddy back to previous build in < 10 s", async () => {
    // 1. Create app — build #1 is auto-enqueued on creation.
    ;({ id: appId, slug } = await createApp(auth, {
      name: `fixture-rb-${Date.now()}`,
      repoFullName: "ploydok/fixture-nextjs",
      branch: "main",
      buildMethod: "docker",
    }))

    const build1: BuildRow = await pollBuildStatus(auth, appId, {
      timeoutMs: 180_000,
    })
    const buildId1 = build1.id
    console.log(`[dod-09] build #1 id=${buildId1} succeeded`)

    // 2. Verify live proxy returns build #1 identifier.
    const res1 = await fetchViaProxy(slug, "/")
    expect(res1.status, "build #1 proxy response should be 200").toBe(200)
    const html1 = await res1.text()
    expect(
      html1,
      `proxy HTML should contain build: ${buildId1}`,
    ).toContain(`build: ${buildId1}`)

    // 3. Trigger deploy → wait for build #2.
    await triggerDeploy(auth, appId)
    const build2: BuildRow = await pollBuildStatus2(auth, appId, buildId1, {
      timeoutMs: 180_000,
      intervalMs: 2_000,
    })
    const buildId2 = build2.id
    console.log(`[dod-09] build #2 id=${buildId2} succeeded`)

    // 4. Sanity: proxy now serves build #2.
    const res2 = await fetchViaProxy(slug, "/")
    expect(res2.status, "build #2 proxy response should be 200").toBe(200)
    const html2 = await res2.text()
    expect(
      html2,
      `proxy should now serve build #2 (build: ${buildId2})`,
    ).toContain(`build: ${buildId2}`)
    expect(
      html2,
      "proxy should no longer serve build #1 before rollback",
    ).not.toContain(`build: ${buildId1}`)

    // 5. Rollback — measure wall-clock time until Caddy serves build #1 again.
    const { durationMs } = await chrono(async () => {
      await triggerRollback(auth, appId)

      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        try {
          const r = await fetchViaProxy(slug, "/")
          if (r.ok) {
            const html = await r.text()
            if (html.includes(`build: ${buildId1}`)) return
          }
        } catch {
          // network hiccup during swap — keep polling
        }
        await new Promise<void>((res) => setTimeout(res, 200))
      }
      throw new Error(
        `rollback did not swap back to build #1 (${buildId1}) within 15 s`,
      )
    })

    // 6. Assertions.
    console.log(`[dod-09] rollback completed in ${durationMs.toFixed(0)} ms`)
    expect(durationMs, "rollback must complete in < 10 s").toBeLessThan(10_000)

    // Final confirmation: build #1 is live.
    const resRolledBack = await fetchViaProxy(slug, "/")
    expect(resRolledBack.status, "rolled-back proxy response should be 200").toBe(200)
    const htmlRolledBack = await resRolledBack.text()
    expect(
      htmlRolledBack,
      `after rollback proxy should serve build: ${buildId1}`,
    ).toContain(`build: ${buildId1}`)

    // Retrieve current app state to verify container info is consistent.
    const detailRes = await fetch(`${API_URL}/apps/${appId}`, {
      headers: { cookie: auth.cookie },
    })
    expect(detailRes.ok, "GET /apps/:id should return 200 after rollback").toBe(true)
  })
})
