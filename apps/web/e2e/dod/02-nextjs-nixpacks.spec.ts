// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test"
import {
  REAL_E2E,
  cleanupApp,
  createApp,
  fetchViaProxy,
  loginViaApi,
  pollBuildStatus,
} from "./_harness"
import type { AuthContext } from "./_harness"

test.describe("DoD #1 — deploy Next.js via Nixpacks", () => {
  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")
  // Nixpacks + Next.js cold build is heavier than a plain docker build.
  test.describe.configure({ timeout: 240_000 })

  let auth: AuthContext
  let appId = ""
  let slug = ""

  test.beforeAll(async () => {
    auth = await loginViaApi()
  })

  test.afterAll(async () => {
    if (appId) {
      await cleanupApp(auth, appId)
    }
  })

  test("Nixpacks auto-detects Next.js; build succeeds and root path returns expected HTML", async () => {
    // 1. Create app with nixpacks build method — the API must ignore any
    //    Dockerfile present in the repo and let Nixpacks handle detection.
    const created = await createApp(auth, {
      name: "fixture-nextjs-nixpacks",
      repoFullName: "MakFly/fixture-nextjs",
      branch: "main",
      buildMethod: "nixpacks",
    })
    appId = created.id
    slug = created.slug

    expect(appId, "app.id must be present after creation").toBeTruthy()
    expect(slug, "app.slug must be present after creation").toBeTruthy()

    // 2. Wait for build to succeed (longer timeout — pip/npm installs cold).
    const build = await pollBuildStatus(auth, appId, { timeoutMs: 240_000 })

    expect(build.status, "build status must be succeeded").toBe("succeeded")

    // 3. Verify the app is reachable through Caddy.
    const res = await fetchViaProxy(slug, "/")

    expect(res.status, "HTTP status via Caddy").toBe(200)

    // 4. Verify the response body contains the expected marker.
    const html = await res.text()

    expect(html, 'body must contain "hello from ploydok (nextjs)"').toContain(
      "hello from ploydok (nextjs)"
    )
  })
})
