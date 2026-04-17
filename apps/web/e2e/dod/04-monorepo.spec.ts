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

test.describe("DoD #3 — deploy monorepo with rootDir + Dockerfile override", () => {
  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")
  test.describe.configure({ timeout: 180_000 })

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

  test("build scoped to apps/server/ succeeds and root path returns expected JSON", async () => {
    // 1. Create app pointing to the sub-directory of the monorepo fixture.
    //    rootDir restricts the build context; dockerfilePath is relative to rootDir.
    const created = await createApp(auth, {
      name: "fixture-monorepo-server",
      repoFullName: "ploydok/fixture-monorepo",
      branch: "main",
      rootDir: "apps/server",
      dockerfilePath: "Dockerfile",
      buildMethod: "docker",
    })
    appId = created.id
    slug = created.slug

    expect(appId, "app.id must be present after creation").toBeTruthy()
    expect(slug, "app.slug must be present after creation").toBeTruthy()

    // 2. Wait for build to succeed.
    const build = await pollBuildStatus(auth, appId, { timeoutMs: 180_000 })

    expect(build.status, "build status must be succeeded").toBe("succeeded")

    // 3. Verify the app is reachable through Caddy.
    const res = await fetchViaProxy(slug, "/")

    expect(res.status, "HTTP status via Caddy").toBe(200)

    // 4. Parse JSON and verify the expected sub-app marker.
    const json = (await res.json()) as unknown

    expect(
      JSON.stringify(json),
      'root JSON must contain "hello from ploydok (monorepo/server)"'
    ).toContain("hello from ploydok (monorepo/server)")
  })
})
