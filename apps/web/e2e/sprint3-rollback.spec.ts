// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint-3 E2E — M4.1 spec 3: Rollback < 10 seconds
 *
 * DoD assertion:
 *   - The time from clicking "Rollback" to the app reaching status="running"
 *     again is less than 10 000 ms.
 *   - The app domain responds HTTP 200 after rollback.
 *
 * Gate: requires PLOYDOK_FULL_INFRA=1.
 *
 * Required env vars (in addition to auth vars from helpers/auth.ts):
 *   E2E_FIXTURE_APP_ID       – id of an app with at least 2 successful builds.
 *   E2E_FIXTURE_APP_DOMAIN   – hostname of that app.
 *   E2E_FIXTURE_ROLLBACK_BUILD_ID – the build id to roll back to (optional;
 *                                   if absent the test uses the API-returned
 *                                   latestBuildId which is the previous build).
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
const ROLLBACK_TIMEOUT_MS = 10_000;
const ROLLBACK_POLL_MS = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch app detail from API (no UI). */
async function fetchApp(
  appId: string,
  cookies: string,
): Promise<{ status: string; domain: string | null; latestBuildId: string | null }> {
  const res = await fetch(`${API}/apps/${appId}`, {
    headers: { cookie: cookies },
  });
  if (!res.ok) throw new Error(`fetchApp failed: ${res.status}`);
  const data = (await res.json()) as {
    app: { status: string; domain: string | null; latestBuildId: string | null };
  };
  return data.app;
}

/** Poll until status = 'running' with tight poll interval. */
async function waitForRunning(
  appId: string,
  cookies: string,
  timeoutMs: number,
): Promise<number> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const app = await fetchApp(appId, cookies);
    if (app.status === "running") return Date.now() - start;
    if (app.status === "failed") {
      throw new Error(`App ${appId} failed during rollback`);
    }
    await new Promise((r) => setTimeout(r, ROLLBACK_POLL_MS));
  }
  throw new Error(`App ${appId} did not reach 'running' within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("sprint3 — rollback < 10 s", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(!FULL_INFRA, "requires PLOYDOK_FULL_INFRA=1 (BuildKit + Registry + Agent + Caddy)");

  test("rollback completes in under 10 seconds and domain responds 200", async ({ page }) => {
    const appId = process.env.E2E_FIXTURE_APP_ID;
    const appDomain = process.env.E2E_FIXTURE_APP_DOMAIN;

    if (!appId || !appDomain) {
      test.skip();
      return;
    }

    // -------------------------------------------------------------------
    // 1. Login
    // -------------------------------------------------------------------
    await loginWithBackupCode(page);

    const cookies = await page.context().cookies();
    const authCookies = cookies
      .filter((c) => c.name.startsWith("ploydok_"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    // -------------------------------------------------------------------
    // 2. Verify app is running before rollback
    // -------------------------------------------------------------------
    const appBefore = await fetchApp(appId, authCookies);
    expect(appBefore.status).toBe("running");

    // -------------------------------------------------------------------
    // 3. Navigate to app detail
    // -------------------------------------------------------------------
    await page.goto(`${WEB_URL}/apps/${appId}`);
    await page.waitForURL(/\/apps\/[^/]+/);

    // Confirm the AppStatusBadge shows "Running" before we start.
    await expect(
      page.getByRole("status", { name: /app status: running/i }),
    ).toBeVisible({ timeout: 10_000 });

    // -------------------------------------------------------------------
    // 4. Open Actions dropdown and click Rollback
    //    The dropdown is toggled by the "Actions" button (aria-haspopup="menu").
    // -------------------------------------------------------------------
    await page.getByRole("button", { name: /actions/i }).click();
    // Wait for the dropdown menu to appear.
    await page.getByRole("menuitem", { name: /rollback/i }).waitFor({ timeout: 5_000 });

    // -------------------------------------------------------------------
    // 5. Start timer and click Rollback
    // -------------------------------------------------------------------
    const rollbackStart = Date.now();
    await page.getByRole("menuitem", { name: /rollback/i }).click();

    // -------------------------------------------------------------------
    // 6. Poll via API (tight 200ms interval) for status = 'running'
    // -------------------------------------------------------------------
    const rollbackDuration = await waitForRunning(appId, authCookies, ROLLBACK_TIMEOUT_MS);
    const wallClock = Date.now() - rollbackStart;

    console.log(
      `[sprint3-rollback] API reports running after ${rollbackDuration}ms` +
        ` (wall clock ${wallClock}ms, limit ${ROLLBACK_TIMEOUT_MS}ms)`,
    );

    // -------------------------------------------------------------------
    // 7. Assertions
    // -------------------------------------------------------------------

    // 7a. Duration (wall clock) < 10s.
    expect(wallClock).toBeLessThan(ROLLBACK_TIMEOUT_MS);

    // 7b. UI confirms "Running".
    await page.reload();
    await expect(
      page.getByRole("status", { name: /app status: running/i }),
    ).toBeVisible({ timeout: 15_000 });

    // 7c. Domain responds 200.
    const domainRes = await fetch(`http://${appDomain}/`, { redirect: "follow" });
    expect(domainRes.status).toBe(200);
  });
});
