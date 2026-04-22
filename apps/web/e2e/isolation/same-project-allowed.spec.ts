// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint-3bis — counter-test to `cross-project-blocked`.
 *
 * Two apps deployed in the SAME project must be able to resolve and reach
 * each other by container name (they share a project-network bridge). This
 * guards against over-isolation from a future regression that would force
 * every app into a network of its own.
 *
 * Gate: PLOYDOK_E2E_REAL=1 + E2E_TEST_PROJECT_ID (same owner).
 */
import { spawnSync } from "node:child_process"
import { expect, test } from "@playwright/test"
import { API_URL, apiLoginWithCsrf } from "../helpers/auth"

const E2E_REAL = process.env.PLOYDOK_E2E_REAL === "1"
const PROJECT_ID = process.env.E2E_TEST_PROJECT_ID

interface CreatedApp {
  id: string
  slug: string
  containerName: string
}

function docker(args: Array<string>): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync("docker", args, { encoding: "utf8" })
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status }
}

async function createApp(
  auth: { cookie: string; csrfToken: string },
  name: string,
): Promise<CreatedApp> {
  const res = await fetch(`${API_URL}/apps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: auth.cookie,
      "x-csrf-token": auth.csrfToken,
    },
    body: JSON.stringify({
      name,
      projectId: PROJECT_ID,
      gitProvider: "image",
      imageRef: "nginx:alpine",
      imagePullPolicy: "if_not_present",
      plan: "nano",
      healthcheck: { port: 80, path: "/" },
    }),
  })
  if (!res.ok) throw new Error(`createApp(${name}) ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { app: { id: string; slug: string } }
  const shortId = data.app.id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 8)
  return {
    id: data.app.id,
    slug: data.app.slug,
    containerName: `ploydok-app-${data.app.slug}-${shortId}-blue`,
  }
}

async function waitRunning(
  auth: { cookie: string },
  appId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/apps/${appId}`, { headers: { cookie: auth.cookie } })
    if (res.ok) {
      const body = (await res.json()) as { app: { status: string } }
      if (body.app.status === "running") return
      if (body.app.status === "failed") throw new Error(`app ${appId} failed`)
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error(`app ${appId} did not reach running within ${timeoutMs}ms`)
}

async function cleanup(
  auth: { cookie: string; csrfToken: string },
  appId: string | null,
): Promise<void> {
  if (!appId) return
  await fetch(`${API_URL}/apps/${appId}`, {
    method: "DELETE",
    headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
  }).catch(() => {})
}

test.describe("sprint-3bis — same-project communication allowed", () => {
  test.describe.configure({ timeout: 180_000 })

  test.skip(!E2E_REAL, "requires PLOYDOK_E2E_REAL=1 (agent + docker)")
  test.skip(!PROJECT_ID, "requires E2E_TEST_PROJECT_ID")

  let auth: { cookie: string; csrfToken: string }
  let app1: CreatedApp | null = null
  let app2: CreatedApp | null = null

  test.beforeAll(async () => {
    auth = await apiLoginWithCsrf()
  })

  test.afterAll(async () => {
    await cleanup(auth, app1?.id ?? null)
    await cleanup(auth, app2?.id ?? null)
  })

  test("two apps in the same project can reach each other", async () => {
    const suffix = Date.now().toString(36)
    app1 = await createApp(auth, `same-a-${suffix}`)
    app2 = await createApp(auth, `same-b-${suffix}`)

    await waitRunning(auth, app1.id, 120_000)
    await waitRunning(auth, app2.id, 120_000)

    // From inside app1, wget app2's nginx welcome page — must succeed.
    const result = docker([
      "exec",
      app1.containerName,
      "sh",
      "-c",
      `wget --timeout=5 --tries=1 -qO- http://${app2.containerName}:80/ 2>&1 || echo FAILED`,
    ])
    const combined = result.stdout + result.stderr
    expect(combined, "app1 should resolve + reach app2 inside the shared project-network").toContain(
      "Welcome to nginx",
    )
    expect(combined).not.toContain("FAILED")
  })
})
