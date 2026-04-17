// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Ploydok web e2e tests.
 *
 * Default timeout: 30s for standard specs.
 * Sprint-3 infra specs use test.describe.configure({ timeout: 180_000 }) in
 * each spec file to avoid raising the global limit.
 */
export default defineConfig({
  testDir: "./e2e",
  // Default per-test timeout (overridden per-describe in sprint3 specs).
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    // Forward credentials (cookies) so auth helpers work correctly.
    extraHTTPHeaders: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
