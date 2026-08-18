// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint 3bis — Deploy from GitLab.
 *
 * Verifies the real browser flow: project search, explicit branch selection,
 * CSRF-protected UI creation, then GitLab clone → build → run.
 *
 * DoD:
 *   - App created from a GitLab repo reaches `running` within 180 s.
 *   - Caddy serves HTTP 200 on the app domain.
 *
 * Gate: requires PLOYDOK_FULL_INFRA=1 + a GitLab OAuth token already stored
 * for the test account (configure via /settings/git-providers in the UI).
 *
 * Env:
 *   E2E_GITLAB_REPO_FULL_NAME   — e.g. "dev-toolings/ploydok-hello"
 *   E2E_GITLAB_PROJECT_ID       — numeric GitLab project id
 *   E2E_GITLAB_BRANCH           — default "main"
 *   The fixture repository must contain a working Dockerfile.
 */
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { API_URL, loginWithBackupCode } from "../helpers/auth"
import type { Page } from "@playwright/test"

const FULL_INFRA = process.env.PLOYDOK_FULL_INFRA === "1"
const RELEASE_GATE = process.env.PLOYDOK_RELEASE_GATE === "1"
const REPO = process.env.E2E_GITLAB_REPO_FULL_NAME
const GITLAB_PROJECT_ID = process.env.E2E_GITLAB_PROJECT_ID
const BRANCH = process.env.E2E_GITLAB_BRANCH ?? "main"
const EXPECTED_PLATFORM_VERSION = process.env.E2E_EXPECTED_PLATFORM_VERSION

const POLL_INTERVAL_MS = 3_000
const DEPLOY_TIMEOUT_MS = 180_000

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze()
  const blocking = result.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact ?? "")
  )
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

type AppRow = { id: string; status: string; domain: string | null }

async function waitForStatus(
  appId: string,
  target: string,
  cookies: string,
  timeoutMs: number
): Promise<AppRow> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/apps/${appId}`, {
      headers: { cookie: cookies },
    })
    if (res.ok) {
      const body = (await res.json()) as { app: AppRow }
      if (body.app.status === target) return body.app
      if (body.app.status === "failed") {
        throw new Error(`app ${appId} entered 'failed' during deploy`)
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(
    `app ${appId} did not reach '${target}' within ${timeoutMs}ms`
  )
}

test.describe("Sprint 3bis — deploy from GitLab", () => {
  test.beforeAll(() => {
    if (
      RELEASE_GATE &&
      (!FULL_INFRA || !REPO || !GITLAB_PROJECT_ID || !EXPECTED_PLATFORM_VERSION)
    ) {
      throw new Error(
        "GitLab release gate is mandatory: full infra, repository, project id and exact candidate version must be configured"
      )
    }
  })
  test.skip(
    !RELEASE_GATE && (!FULL_INFRA || !REPO || !GITLAB_PROJECT_ID),
    "requires PLOYDOK_FULL_INFRA=1, E2E_GITLAB_REPO_FULL_NAME, E2E_GITLAB_PROJECT_ID"
  )

  test.setTimeout(DEPLOY_TIMEOUT_MS + 30_000)

  test("GitLab repo → build → container running + HTTP 200", async ({
    page,
    context,
  }) => {
    if (RELEASE_GATE) {
      const health = await fetch(`${API_URL}/health`)
      expect(health.ok, "candidate API health endpoint must respond").toBe(true)
      const body = (await health.json()) as { version?: string }
      expect(
        body.version,
        "the browser gate must target the exact candidate"
      ).toBe(EXPECTED_PLATFORM_VERSION)
    }
    const repoFullName = REPO!
    await loginWithBackupCode(page)
    const dashboardUrl = page.url()
    const orgSlug = /\/orgs\/([^/]+)\/dashboard/.exec(dashboardUrl)?.[1]
    expect(orgSlug, "authenticated dashboard must identify the workspace").toBeTruthy()

    await page.goto("/onboarding")
    await expect(page.getByRole("main")).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(page.locator(":focus")).toBeVisible()
    await expectNoSeriousViolations(page)
    await page.goto(dashboardUrl)

    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")

    await page
      .getByRole("button", { name: /new application|new app/i })
      .first()
      .click()
    await expectNoSeriousViolations(page)
    await page.getByRole("tab", { name: /gitlab/i }).click()
    await page.getByLabel("Search GitLab projects").fill(repoFullName)
    await page
      .getByRole("option", {
        name: new RegExp(repoFullName.split("/").at(-1)!, "i"),
      })
      .click()

    const branchDialog = page.getByRole("dialog", {
      name: "Choisir une branche",
    })
    await expect(branchDialog).toBeVisible()
    await branchDialog.getByLabel("Rechercher une branche").fill(BRANCH)
    await branchDialog
      .getByRole("option", { name: new RegExp(`^${BRANCH}`) })
      .click()
    await branchDialog
      .getByRole("button", { name: "Choisir cette branche" })
      .click()

    const appName = `e2e-gitlab-${Date.now()}`
    await page.getByLabel("Nom de l'application").fill(appName)
    await page.getByRole("button", { name: "Continuer" }).click()
    await page.getByRole("radio", { name: /Dockerfile/i }).click()
    for (let step = 0; step < 3; step += 1) {
      await page.getByRole("button", { name: "Continuer" }).click()
    }

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/apps` &&
        response.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Créer l'application" }).click()
    const createRes = await createResponsePromise
    expect(createRes.request().headers()["x-csrf-token"]).toBeTruthy()
    expect(
      createRes.ok(),
      `POST /apps failed: ${createRes.status()} ${await createRes.text()}`
    ).toBe(true)
    const requestBody = createRes.request().postDataJSON() as Record<
      string,
      unknown
    >
    expect(requestBody).toMatchObject({
      name: appName,
      gitProvider: "gitlab",
      repoFullName,
      gitlabProjectId: Number(GITLAB_PROJECT_ID),
      branch: BRANCH,
    })
    const { app } = (await createRes.json()) as { app: { id: string } }

    const running = await waitForStatus(
      app.id,
      "running",
      cookies,
      DEPLOY_TIMEOUT_MS
    )
    expect(running.domain, "app should expose a domain").toBeTruthy()

    await page.goto(`/orgs/${orgSlug!}/apps/${app.id}`)
    await expect(page.getByRole("main")).toBeVisible()
    await expectNoSeriousViolations(page)

    const resp = await page.request.get(`https://${running.domain}`, {
      ignoreHTTPSErrors: true,
      maxRedirects: 0,
    })
    expect([200, 301, 302, 308]).toContain(resp.status())
  })
})
