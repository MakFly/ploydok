// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auth helpers for Playwright e2e tests.
 *
 * The Ploydok login flow uses passkeys (WebAuthn) as primary method, but
 * backup-code login is available for automated tests.
 *
 * Required env vars (all have dev defaults):
 *   E2E_API_URL          – defaults to http://localhost:4000
 *   E2E_WEB_URL          – defaults to http://localhost:5173
 *   E2E_TEST_EMAIL       – backup-code login email
 *   E2E_TEST_BACKUP_CODE – backup code for that account (format: XXXX-XXXX-XXXX)
 */
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
export const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
// loginWithBackupCode
// ---------------------------------------------------------------------------

/**
 * Sign in using the backup-code form.
 * Navigates to /login, switches to backup-code mode, fills the form and
 * waits for a redirect to /dashboard.
 */
export async function loginWithBackupCode(page: Page): Promise<void> {
  const email = process.env.E2E_TEST_EMAIL;
  const code = process.env.E2E_TEST_BACKUP_CODE;

  if (!email || !code) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set to run authenticated tests",
    );
  }

  await page.goto(`${WEB_URL}/login`);

  // Switch to backup-code mode.
  await page.getByRole("button", { name: /backup code/i }).click();

  // Fill email.
  await page.locator("input#email").fill(email);

  // Fill backup code.
  await page.locator("input#code").fill(code);

  // Submit.
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for navigation away from login page (redirect to /dashboard).
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// apiLogin — direct HTTP login for setup helpers (no browser)
// ---------------------------------------------------------------------------

/**
 * Perform a programmatic backup-code login and return the Set-Cookie header
 * value so it can be injected into API requests inside beforeAll helpers.
 */
export async function apiLogin(): Promise<string> {
  const email = process.env.E2E_TEST_EMAIL;
  const code = process.env.E2E_TEST_BACKUP_CODE;

  if (!email || !code) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_BACKUP_CODE must be set for apiLogin()",
    );
  }

  const res = await fetch(`${API_URL}/auth/backup-codes/consume`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`apiLogin failed (${res.status}): ${body}`);
  }

  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("apiLogin: no Set-Cookie header in response");
  return setCookie;
}
