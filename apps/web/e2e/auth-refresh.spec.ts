// SPDX-License-Identifier: AGPL-3.0-only
// E2E Playwright spec — verifies the refresh-token fix end-to-end.
//
// Prerequisites (must be running locally):
//   - make dev (web on :5173, api on :3335)
//   - A test user in the DB with a fresh backup code, exposed via env:
//       E2E_TEST_EMAIL=...
//       E2E_TEST_BACKUP_CODE=XXXX-XXXX-XXXX
//
// Each test consumes one backup code (one-shot), so re-generate before re-running.

import { expect, test } from "@playwright/test";
import { loginWithBackupCode } from "./helpers/auth";

const ACCESS_COOKIE_NAME = "ploydok_access";
const REFRESH_COOKIE_NAME = "ploydok_refresh";

const skipReason = "E2E_TEST_EMAIL / E2E_TEST_BACKUP_CODE must be set";

test.describe("auth refresh — F5 with expired access token", () => {
  test.skip(
    !process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_BACKUP_CODE,
    skipReason,
  );

  test("F5 on /dashboard with stripped ploydok_access stays logged in and rotates cookies", async ({
    page,
    context,
  }) => {
    // 1. Login normally → land on /dashboard with access + refresh cookies set.
    await loginWithBackupCode(page);
    await expect(page).toHaveURL(/\/dashboard/);

    const initialCookies = await context.cookies();
    const initialAccess = initialCookies.find((c) => c.name === ACCESS_COOKIE_NAME);
    const initialRefresh = initialCookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(initialAccess, "ploydok_access set after login").toBeDefined();
    expect(initialRefresh, "ploydok_refresh set after login").toBeDefined();

    // 2. Simulate access-token expiration: drop ONLY the access cookie. The
    //    refresh cookie stays valid. Playwright manages the cookie store
    //    natively, so HttpOnly is not a problem here.
    await context.clearCookies();
    await context.addCookies(
      initialCookies.filter((c) => c.name !== ACCESS_COOKIE_NAME),
    );

    // 3. Listen for /auth/refresh requests during the reload.
    const refreshRequests: Array<string> = [];
    page.on("request", (req) => {
      if (req.url().includes("/auth/refresh")) refreshRequests.push(req.url());
    });

    // 4. F5. The SSR beforeLoad calls /me → 401 → /auth/refresh → retry → 200.
    //    The refresh response sets a new ploydok_access via appendResponseHeader.
    await page.reload({ waitUntil: "domcontentloaded" });

    // 5. Still on /dashboard, NOT redirected to /login.
    await expect(page).toHaveURL(/\/dashboard/);

    // 6. /auth/refresh hit at least once (could be SSR + client hydration).
    expect(refreshRequests.length, "refresh endpoint was called").toBeGreaterThanOrEqual(1);

    // 7. The new ploydok_access cookie was set (rotation succeeded end-to-end).
    const finalCookies = await context.cookies();
    const finalAccess = finalCookies.find((c) => c.name === ACCESS_COOKIE_NAME);
    expect(finalAccess, "ploydok_access restored by refresh").toBeDefined();
    expect(finalAccess?.value.length).toBeGreaterThan(0);
    expect(finalAccess?.value).not.toBe(initialAccess?.value);

    // 8. The refresh cookie was rotated too (defense-in-depth).
    const finalRefresh = finalCookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(finalRefresh?.value).not.toBe(initialRefresh?.value);
  });

  test("client navigation after refresh does not trigger a second /auth/refresh", async ({
    page,
    context,
  }) => {
    await loginWithBackupCode(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // Strip access cookie, reload to force the refresh path
    let cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(cookies.filter((c) => c.name !== ACCESS_COOKIE_NAME));

    const refreshRequests: Array<string> = [];
    page.on("request", (req) => {
      if (req.url().includes("/auth/refresh")) refreshRequests.push(req.url());
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard/);

    // After refresh, navigate to another protected route via client-side
    // navigation (no full page reload). The new ploydok_access cookie should
    // be valid → no second /auth/refresh call.
    cookies = await context.cookies();
    const accessAfterFirstRefresh = cookies.find((c) => c.name === ACCESS_COOKIE_NAME);
    expect(accessAfterFirstRefresh).toBeDefined();

    const refreshCountBefore = refreshRequests.length;
    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/apps/);

    expect(
      refreshRequests.length,
      "no extra refresh after a navigation following a successful refresh",
    ).toBe(refreshCountBefore);
  });
});
