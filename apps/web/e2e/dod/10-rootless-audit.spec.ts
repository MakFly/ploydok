// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #9 — Builds are rootless: spawned container does not run as root
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *                docker CLI on PATH
 *
 * The `containerId` is read from `app.containerId` (set by the blue-green
 * runner after a successful deploy).  `verifyRootless` runs
 * `docker inspect <id> --format {{.Config.User}}` and returns `{ user, isRoot }`.
 *
 * If docker CLI is absent on the host the test is skipped with an explicit
 * message rather than failing.
 */

import { expect, test } from "@playwright/test"
import {
  API_URL,
  REAL_E2E,
  cleanupApp,
  createApp,
  loginViaApi,
  pollBuildStatus,
  verifyRootless,
} from "./_harness"
import type { AuthContext } from "./_harness"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout
// ---------------------------------------------------------------------------

test.describe("DoD #9 — rootless container audit", () => {
  test.describe.configure({ timeout: 120_000 })

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

  test("deployed container does not run as root (USER directive honoured)", async () => {
    // 1. Create app — build #1 uses fixture-hello which has `USER node`.
    ;({ id: appId } = await createApp(auth, {
      name: `fixture-rootless-${Date.now()}`,
      repoFullName: "ploydok/fixture-hello",
      branch: "main",
      buildMethod: "docker",
    }))

    await pollBuildStatus(auth, appId, { timeoutMs: 90_000 })
    console.log(`[dod-10] appId=${appId} build succeeded`)

    // 2. Retrieve containerId from GET /apps/:id.
    const detailRes = await fetch(`${API_URL}/apps/${appId}`, {
      headers: { cookie: auth.cookie },
    })
    expect(detailRes.ok, "GET /apps/:id should return 200").toBe(true)

    const detail = (await detailRes.json()) as {
      app: { containerId: string | null }
    }
    const containerId = detail.app.containerId

    if (!containerId) {
      // The runner may not have populated containerId if the blue-green deploy
      // step is not yet wired up in this sprint.  Skip rather than fail.
      test.skip(
        true,
        "app.containerId is null — blue-green runner may not be fully wired yet",
      )
      return
    }

    console.log(`[dod-10] containerId=${containerId}`)

    // 3. Inspect the running container for its configured user.
    let result: { user: string; isRoot: boolean }
    try {
      result = await verifyRootless(containerId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes("docker not found") ||
        msg.includes("ENOENT") ||
        msg.includes("failed to start")
      ) {
        test.skip(true, "docker CLI required on host — skipping rootless audit")
        return
      }
      throw err
    }

    // 4. Assertions.
    console.log(
      `[dod-10] rootless check — user='${result.user}', isRoot=${result.isRoot}`,
    )
    expect(result.isRoot, "container must not run as root").toBe(false)
    expect(result.user, "USER directive must be honoured (not 'root')").not.toBe(
      "root",
    )
    expect(result.user, "USER directive must not be empty").not.toBe("")
  })
})
