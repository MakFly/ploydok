// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint-3 E2E — M4.1 spec 1: Deploy flow < 2 minutes
 *
 * DoD assertion:
 *   - Full deploy (create app → running container) completes in < 120 000 ms.
 *   - AppStatusBadge shows "Running" after deploy.
 *   - App domain responds HTTP 200.
 *
 * Gate: requires PLOYDOK_FULL_INFRA=1 (BuildKit + Registry + Agent + Caddy).
 * Without that env var the suite is skipped so CI stays green.
 *
 * Required env vars (in addition to auth vars from helpers/auth.ts):
 *   E2E_TEST_PROJECT_ID      – existing project id to create apps under
 *   E2E_TEST_REPO_FULL_NAME  – "owner/repo" of a fixture GitHub repo
 *                              (already authorised in the test account)
 *   E2E_TEST_REPO_BRANCH     – branch to deploy (default: "main")
 */
import { expect, test } from "@playwright/test";
import { API_URL, WEB_URL, loginWithBackupCode } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Infra gate
// ---------------------------------------------------------------------------

const FULL_INFRA = process.env.PLOYDOK_FULL_INFRA === "1";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API = API_URL;
const POLL_INTERVAL_MS = 2_000;
const DEPLOY_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll GET /apps/:id until status matches or timeout. */
async function waitForStatus(
  appId: string,
  targetStatus: string,
  cookies: string,
  timeoutMs: number,
): Promise<{ status: string; domain: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/apps/${appId}`, {
      headers: { cookie: cookies },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        app: { status: string; domain: string | null };
      };
      if (data.app.status === targetStatus) {
        return { status: data.app.status, domain: data.app.domain };
      }
      if (data.app.status === "failed") {
        throw new Error(`App ${appId} entered 'failed' state during deploy`);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`App ${appId} did not reach status '${targetStatus}' within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("sprint3 — deploy flow < 2 min", () => {
  // Override timeout to 180s for this entire describe block.
  test.describe.configure({ timeout: 180_000 });

  test.skip(!FULL_INFRA, "requires PLOYDOK_FULL_INFRA=1 (BuildKit + Registry + Agent + Caddy)");

  let createdAppId: string | null = null;
  let authCookies: string | null = null;

  test.afterAll(async ({ request }) => {
    // Cleanup: delete the app created during the test so the DB stays clean.
    if (createdAppId && authCookies) {
      await request.delete(`${API}/apps/${createdAppId}`, {
        headers: { cookie: authCookies },
      });
    }
  });

  test("full deploy completes in under 2 minutes and app is reachable", async ({ page }) => {
    // -------------------------------------------------------------------
    // 1. Login
    // -------------------------------------------------------------------
    await loginWithBackupCode(page);

    // Capture the auth cookies that the browser now holds so we can use
    // them in direct fetch() calls later.
    const cookies = await page.context().cookies();
    authCookies = cookies
      .filter((c) => c.name.startsWith("ploydok_"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    // -------------------------------------------------------------------
    // 2. Navigate to /apps and open "New app" modal
    // -------------------------------------------------------------------
    await page.goto(`${WEB_URL}/apps`);
    await page.getByRole("button", { name: /new app/i }).click();

    // -------------------------------------------------------------------
    // 3. Step 1 — App name
    // -------------------------------------------------------------------
    const appName = `e2e-deploy-${Date.now()}`;
    await page.locator("input#app-name").fill(appName);
    await page.getByRole("button", { name: /next/i }).click();

    // -------------------------------------------------------------------
    // 4. Step 2 — Repository selection
    //    The fixture repo must be pre-authorised in the test GitHub token.
    //    We look for the repo name in the list and click it.
    // -------------------------------------------------------------------
    const repoFullName =
      process.env.E2E_TEST_REPO_FULL_NAME ?? "ploydok-ci/hello-node";
    const repoName = repoFullName.split("/")[1] ?? repoFullName;

    // Wait for RepoSelector to load the list.
    await page.waitForSelector(`text=${repoName}`, { timeout: 15_000 });
    await page.getByText(repoName, { exact: false }).first().click();

    const branch = process.env.E2E_TEST_REPO_BRANCH ?? "main";
    // Wait for branch select to populate.
    await page.waitForSelector("select#branch-select");
    await page.locator("select#branch-select").selectOption(branch);

    await page.getByRole("button", { name: /next/i }).click();

    // -------------------------------------------------------------------
    // 5. Step 3 — Config (use auto-detection defaults)
    //    Nothing to fill. Click "Create app".
    // -------------------------------------------------------------------
    await page.getByRole("button", { name: /create app/i }).click();

    // Modal should close and we should land on the /apps page or be
    // redirected to the app detail.
    await page.waitForSelector(`text=${appName}`, { timeout: 15_000 });

    // -------------------------------------------------------------------
    // 6. Open the app detail page and click Deploy
    //    We can navigate directly if the app card is a link, otherwise find
    //    it by text and click through.
    // -------------------------------------------------------------------
    await page.getByText(appName).first().click();
    // Expect URL to match /apps/<id>
    await page.waitForURL(/\/apps\/[^/]+/, { timeout: 10_000 });

    // Extract app id from URL.
    const appUrl = page.url();
    const appIdMatch = /\/apps\/([^/]+)/.exec(appUrl);
    const appId = appIdMatch?.[1];
    expect(appId).toBeTruthy();
    createdAppId = appId ?? null;

    // -------------------------------------------------------------------
    // 7. Start timer and click Deploy
    // -------------------------------------------------------------------
    const deployStart = Date.now();

    await page.getByRole("button", { name: /^deploy$/i }).click();

    // -------------------------------------------------------------------
    // 8. Poll API for status=running (max DEPLOY_TIMEOUT_MS)
    // -------------------------------------------------------------------
    const { domain } = await waitForStatus(
      appId!,
      "running",
      authCookies,
      DEPLOY_TIMEOUT_MS,
    );

    const deployDuration = Date.now() - deployStart;

    // -------------------------------------------------------------------
    // 9. Assertions
    // -------------------------------------------------------------------

    // 9a. Duration < 120s.
    expect(deployDuration).toBeLessThan(DEPLOY_TIMEOUT_MS);

    // 9b. UI shows AppStatusBadge "Running".
    //     The badge uses role="status" and aria-label="App status: Running".
    await page.reload();
    await expect(
      page.getByRole("status", { name: /app status: running/i }),
    ).toBeVisible({ timeout: 15_000 });

    // 9c. Domain responds 200.
    if (domain) {
      const domainRes = await fetch(`http://${domain}/`, { redirect: "follow" });
      expect(domainRes.status).toBe(200);
    }

    console.log(
      `[sprint3-deploy] Deploy completed in ${deployDuration}ms (limit ${DEPLOY_TIMEOUT_MS}ms)`,
    );
  });
});
