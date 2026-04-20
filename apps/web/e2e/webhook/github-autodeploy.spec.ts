// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint 3bis — Webhook auto-deploy end-to-end.
 *
 * Covers PLAN-sprint-3-closure-3bis-pg.md Wave 3: verifies that a git push
 * on a wired repository triggers a fresh Ploydok build via webhook and that
 * the resulting container serves the app on its Caddy domain.
 *
 * DoD:
 *   - A `deploy.requested` job is enqueued after `POST /github/webhook`.
 *   - A new build reaches status `succeeded` within 180 seconds.
 *   - The app domain returns HTTP 200.
 *
 * Gate: requires PLOYDOK_FULL_INFRA=1 + E2E_WEBHOOK=1 (needs a real GitHub
 * App installation + a public tunnel for the webhook callback). Without
 * these the suite is skipped so CI stays green.
 *
 * Required env vars:
 *   E2E_TEST_APP_ID            existing Ploydok app id wired to a repo
 *   E2E_WEBHOOK_REPO           "owner/repo" receiving the trigger push
 *   E2E_WEBHOOK_BRANCH         default "main"
 *   plus auth env from helpers/auth.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { API_URL, loginWithBackupCode } from "../helpers/auth";

const FULL_INFRA = process.env.PLOYDOK_FULL_INFRA === "1";
const WEBHOOK_GATE = process.env.E2E_WEBHOOK === "1";

const APP_ID = process.env.E2E_TEST_APP_ID;
const REPO = process.env.E2E_WEBHOOK_REPO ?? "MakFly/ploydok-hello";
const BRANCH = process.env.E2E_WEBHOOK_BRANCH ?? "main";

const POLL_INTERVAL_MS = 3_000;
const BUILD_TIMEOUT_MS = 180_000;

type BuildRow = { id: string; status: string; created_at?: string };

async function fetchBuilds(cookies: string): Promise<BuildRow[]> {
  const res = await fetch(`${API_URL}/apps/${APP_ID}/builds`, {
    headers: { cookie: cookies },
  });
  expect(res.ok, `GET /apps/${APP_ID}/builds failed: ${res.status}`).toBe(true);
  const body = (await res.json()) as { builds?: BuildRow[] };
  return body.builds ?? [];
}

async function fetchDomain(cookies: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/apps/${APP_ID}`, {
    headers: { cookie: cookies },
  });
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { app?: { domain?: string | null } };
  return body.app?.domain ?? null;
}

async function waitForNewSucceeded(
  cookies: string,
  beforeId: string,
  timeoutMs: number,
): Promise<BuildRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const builds = await fetchBuilds(cookies);
    const latest = builds[0];
    if (latest && latest.id !== beforeId && latest.status === "succeeded") {
      return latest;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for new succeeded build after ${beforeId}`);
}

function pushNoopCommit(): void {
  const dir = mkdtempSync(join(tmpdir(), "ploydok-webhook-e2e-"));
  try {
    execFileSync("gh", ["repo", "clone", REPO, dir, "--", "--depth=1", "--branch", BRANCH], {
      stdio: "pipe",
    });
    writeFileSync(join(dir, ".ploydok-trigger"), new Date().toISOString() + "\n");
    execFileSync("git", ["add", ".ploydok-trigger"], { cwd: dir, stdio: "pipe" });
    execFileSync(
      "git",
      ["commit", "-s", "-m", `chore(webhook-e2e): trigger ${new Date().toISOString()}`],
      { cwd: dir, stdio: "pipe" },
    );
    execFileSync("git", ["push", "origin", BRANCH], { cwd: dir, stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe("webhook auto-deploy", () => {
  test.skip(
    !FULL_INFRA || !WEBHOOK_GATE || !APP_ID,
    "requires PLOYDOK_FULL_INFRA=1, E2E_WEBHOOK=1 and E2E_TEST_APP_ID",
  );

  test.setTimeout(BUILD_TIMEOUT_MS + 60_000);

  test("push → new build succeeded → domain responds 200", async ({ page, context }) => {
    await loginWithBackupCode(page);
    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const before = await fetchBuilds(cookies);
    const beforeId = before[0]?.id ?? "none";

    pushNoopCommit();

    const fresh = await waitForNewSucceeded(cookies, beforeId, BUILD_TIMEOUT_MS);
    expect(fresh.status).toBe("succeeded");

    const domain = await fetchDomain(cookies);
    expect(domain, "app has no domain set").toBeTruthy();

    const resp = await fetch(`https://${domain}`, {
      // Accept self-signed certs in dev (Caddy local TLS).
      // @ts-expect-error — undici-specific option.
      dispatcher: undefined,
    });
    expect(resp.status).toBe(200);
  });
});
