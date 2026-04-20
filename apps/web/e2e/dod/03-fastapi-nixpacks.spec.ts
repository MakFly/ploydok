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

test.describe("DoD #2 — deploy FastAPI via Nixpacks", () => {
  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")
  // pip install fastapi + uvicorn cold is slow.
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

  test("Nixpacks detects Python/FastAPI; build succeeds and endpoints return expected responses", async () => {
    // 1. Create app — fixture-fastapi has no Dockerfile; Nixpacks reads
    //    Procfile + requirements.txt + runtime.txt to assemble the image.
    const created = await createApp(auth, {
      name: "fixture-fastapi-nixpacks",
      repoFullName: "MakFly/fixture-fastapi",
      branch: "main",
      buildMethod: "nixpacks",
    })
    appId = created.id
    slug = created.slug

    expect(appId, "app.id must be present after creation").toBeTruthy()
    expect(slug, "app.slug must be present after creation").toBeTruthy()

    // 2. Wait for build to succeed.
    const build = await pollBuildStatus(auth, appId, { timeoutMs: 240_000 })

    expect(build.status, "build status must be succeeded").toBe("succeeded")

    // 3. Root endpoint: 200 + JSON body with expected marker.
    const rootRes = await fetchViaProxy(slug, "/")

    expect(rootRes.status, "HTTP status via Caddy for /").toBe(200)

    const rootJson = (await rootRes.json()) as unknown

    expect(
      JSON.stringify(rootJson),
      'root JSON must contain "hello from ploydok (fastapi)"'
    ).toContain("hello from ploydok (fastapi)")

    // 4. Health endpoint: 200 + body contains "ok".
    const healthRes = await fetchViaProxy(slug, "/health")

    expect(healthRes.status, "HTTP status via Caddy for /health").toBe(200)

    const healthText = await healthRes.text()

    expect(healthText, '/health body must contain "ok"').toContain("ok")
  })
})
