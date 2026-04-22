// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auth helpers for Playwright e2e tests.
 *
 * The Ploydok login flow uses passkeys (WebAuthn) as primary method, but
 * backup-code login is available for automated tests.
 *
 * Required env vars (all have dev defaults):
 *   E2E_API_URL          – defaults to http://localhost:3335
 *   E2E_WEB_URL          – defaults to http://localhost:5173
 *   E2E_TEST_EMAIL       – backup-code login email
 *   E2E_TEST_BACKUP_CODE – backup code for that account (format: XXXX-XXXX-XXXX)
 */
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3335";
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

// ---------------------------------------------------------------------------
// apiLoginWithCsrf — login + fetch CSRF token for authenticated mutations
// ---------------------------------------------------------------------------

/**
 * Log in via backup code AND fetch a CSRF token so e2e helpers can POST/DELETE
 * against the API. Returns a single `Cookie` header value already merged with
 * the `csrf` cookie, plus the matching `X-CSRF-Token` header value.
 *
 * Usage:
 *   const { cookie, csrfToken } = await apiLoginWithCsrf();
 *   await fetch(`${API_URL}/apps`, {
 *     method: "POST",
 *     headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
 *     body: JSON.stringify({ ... }),
 *   });
 */
export async function apiLoginWithCsrf(): Promise<{ cookie: string; csrfToken: string }> {
  const loginSetCookie = await apiLogin();
  const authPairs = parseCookiePairs(loginSetCookie);

  const csrfRes = await fetch(`${API_URL}/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`apiLoginWithCsrf: GET /auth/csrf failed (${csrfRes.status})`);
  }
  const csrfSetCookie = csrfRes.headers.get("set-cookie") ?? "";
  const csrfPairs = parseCookiePairs(csrfSetCookie);
  const csrfToken = csrfPairs.get("csrf");
  if (!csrfToken) throw new Error("apiLoginWithCsrf: no csrf cookie returned");

  const merged = new Map([...authPairs, ...csrfPairs]);
  const cookie = Array.from(merged, ([k, v]) => `${k}=${v}`).join("; ");
  return { cookie, csrfToken };
}

/** Parse a Set-Cookie header string into a Map of cookie name → value. */
function parseCookiePairs(setCookieHeader: string): Map<string, string> {
  const out = new Map<string, string>();
  // `fetch` merges multiple Set-Cookie into one comma-separated string on some
  // runtimes. Split on "; " then accept only pairs that look like name=value
  // and are not attribute keywords (Path, Max-Age, SameSite, HttpOnly, Secure…).
  const ATTRS = new Set(["path", "max-age", "samesite", "httponly", "secure", "expires", "domain"]);
  for (const segment of setCookieHeader.split(/,(?=[^;]+=)/)) {
    const firstPair = segment.split(";")[0]?.trim();
    if (!firstPair) continue;
    const eq = firstPair.indexOf("=");
    if (eq <= 0) continue;
    const name = firstPair.slice(0, eq).trim();
    const value = firstPair.slice(eq + 1).trim();
    if (ATTRS.has(name.toLowerCase())) continue;
    out.set(name, value);
  }
  return out;
}
