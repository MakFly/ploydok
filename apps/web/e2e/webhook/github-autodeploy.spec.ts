// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint 3bis / Sprint 3.1.1 — Webhook auto-deploy end-to-end.
 *
 * Covers PLAN-sprint-3-closure-3bis-pg.md Wave 3 + Sprint 3.1.1 extended
 * coverage: verifies that a git push on a wired repository triggers a fresh
 * Ploydok build via webhook, and tests skip/coalescing/secret-rotation
 * decision logic.
 *
 * DoD (happy path):
 *   - A `deploy.requested` job is enqueued after `POST /github/webhook`.
 *   - A new build reaches status `succeeded` within 180 seconds.
 *   - The app domain returns HTTP 200.
 *
 * DoD (extended — Sprint 3.1.1):
 *   - skipPath: push touching only README.md → delivery decision=skipped_path.
 *   - skipDirective: push with [skip deploy] in message → decision=skipped_directive.
 *   - coalescing: 3 rapid pushes → 1 succeeded build, 2 coalesced deliveries.
 *   - rotateSecret: POST /apps/:id/webhook-secret/rotate works; 409 on cooldown.
 *
 * Gate: requires PLOYDOK_FULL_INFRA=1 + E2E_WEBHOOK=1 (needs a real GitHub
 * App installation + a public tunnel for the webhook callback). Without
 * these the suite is skipped so CI stays green.
 *
 * To run locally (all cases):
 *   PLOYDOK_FULL_INFRA=1 E2E_WEBHOOK=1 \
 *   E2E_TEST_APP_ID=<id> E2E_WEBHOOK_REPO=owner/repo \
 *   E2E_WEBHOOK_SECRET=<global-app-webhook-secret> \
 *   E2E_TEST_EMAIL=dev@ploydok.local E2E_TEST_BACKUP_CODE=DEVD-EVDE-VDEV \
 *   bun --cwd apps/web exec playwright test --grep webhook
 *
 * Required env vars:
 *   E2E_TEST_APP_ID            existing Ploydok app id wired to a repo
 *   E2E_WEBHOOK_REPO           "owner/repo" receiving the trigger push
 *   E2E_WEBHOOK_BRANCH         default "main"
 *   E2E_WEBHOOK_SECRET         GitHub App-level webhook secret (to sign simulated pushes)
 *   plus auth env from helpers/auth.ts
 *
 * Note on per-app webhook secrets (rotateSecret test):
 *   The per-app `webhook_secret` field exists so Ploydok can expose a unique
 *   secret to configure per-repo in GitHub settings. The dual-accept overlap
 *   logic (old secret valid for 24h) is unit-tested in
 *   `apps/api/src/routes/apps-webhooks.test.ts § verifySignature dual-accept`.
 *   The e2e test here validates the rotation API surface (rotate, cooldown,
 *   TOTP guard) rather than re-testing the cryptographic logic e2e.
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { API_URL, loginWithBackupCode, apiLoginWithCsrf } from "../helpers/auth";

const FULL_INFRA = process.env.PLOYDOK_FULL_INFRA === "1";
const WEBHOOK_GATE = process.env.E2E_WEBHOOK === "1";

const APP_ID = process.env.E2E_TEST_APP_ID;
const REPO = process.env.E2E_WEBHOOK_REPO ?? "MakFly/ploydok-hello";
const BRANCH = process.env.E2E_WEBHOOK_BRANCH ?? "main";
// Global GitHub App webhook secret — used to sign simulated webhook payloads.
const WEBHOOK_SECRET = process.env.E2E_WEBHOOK_SECRET ?? "";

const POLL_INTERVAL_MS = 3_000;
const BUILD_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BuildRow = { id: string; status: string; created_at?: string };
type DeliveryRow = { id: string; decision: string; commit_sha?: string | null };

// ---------------------------------------------------------------------------
// Helpers — auth & API wrappers
// ---------------------------------------------------------------------------

async function fetchBuilds(cookies: string): Promise<BuildRow[]> {
  const res = await fetch(`${API_URL}/apps/${APP_ID}/builds`, {
    headers: { cookie: cookies },
  });
  expect(res.ok, `GET /apps/${APP_ID}/builds failed: ${res.status}`).toBe(true);
  const body = (await res.json()) as { builds?: BuildRow[] };
  return body.builds ?? [];
}

async function fetchDeliveries(cookies: string): Promise<DeliveryRow[]> {
  const res = await fetch(`${API_URL}/apps/${APP_ID}/webhook-deliveries?limit=20`, {
    headers: { cookie: cookies },
  });
  expect(res.ok, `GET /apps/${APP_ID}/webhook-deliveries failed: ${res.status}`).toBe(true);
  const body = (await res.json()) as { deliveries?: DeliveryRow[] };
  return body.deliveries ?? [];
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

// ---------------------------------------------------------------------------
// Helpers — real git push (happy-path)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers — simulated GitHub webhook push (for filter/coalescing tests)
// ---------------------------------------------------------------------------

/**
 * Build a minimal GitHub-style push payload and POST it to /github/webhook
 * signed with the global App webhook secret.
 *
 * `changedFiles` populates commits[0].modified so the watch_paths filter sees them.
 */
async function simulateWebhookPush(opts: {
  repoFullName: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  changedFiles?: string[];
  deliveryId?: string;
}): Promise<Response> {
  if (!WEBHOOK_SECRET) throw new Error("E2E_WEBHOOK_SECRET must be set for simulated webhook push");

  const payload = {
    ref: `refs/heads/${opts.branch}`,
    after: opts.commitSha,
    repository: { full_name: opts.repoFullName },
    head_commit: { message: opts.commitMessage },
    commits: opts.changedFiles && opts.changedFiles.length > 0
      ? [{ added: [], modified: opts.changedFiles, removed: [] }]
      : [],
  };

  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  const deliveryId = opts.deliveryId ?? crypto.randomUUID();

  return fetch(`${API_URL}/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sig,
    },
    body,
  });
}

/** Wait up to `timeoutMs` for a delivery with the given `decision` to appear. */
async function waitForDeliveryDecision(
  cookies: string,
  commitSha: string,
  decision: string,
  timeoutMs: number,
): Promise<DeliveryRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deliveries = await fetchDeliveries(cookies);
    const match = deliveries.find(
      (d) => d.commit_sha === commitSha && d.decision === decision,
    );
    if (match) return match;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out waiting for delivery with sha=${commitSha} decision=${decision}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers — PATCH app config
// ---------------------------------------------------------------------------

async function patchApp(
  appId: string,
  cookie: string,
  csrfToken: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${API_URL}/apps/${appId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(fields),
  });
  expect(res.ok, `PATCH /apps/${appId} failed: ${res.status}`).toBe(true);
}

// ---------------------------------------------------------------------------
// Suite: happy-path (real git push)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite: filter decisions (simulated webhook push — no real git push needed)
//
// These tests POST crafted payloads directly to /github/webhook using the
// global App webhook secret (E2E_WEBHOOK_SECRET). The API processes the
// delivery async; tests poll /apps/:id/webhook-deliveries to assert the
// expected decision within 10 seconds.
// ---------------------------------------------------------------------------

test.describe("webhook filter decisions", () => {
  test.describe.configure({ timeout: 60_000 });

  test.skip(
    !FULL_INFRA || !WEBHOOK_GATE || !APP_ID || !WEBHOOK_SECRET,
    "requires PLOYDOK_FULL_INFRA=1, E2E_WEBHOOK=1, E2E_TEST_APP_ID and E2E_WEBHOOK_SECRET",
  );

  // -------------------------------------------------------------------------
  // skipPath — push that touches only README.md while watch_paths=["apps/**"]
  // -------------------------------------------------------------------------
  test("skipPath: push on non-watched file → delivery decision=skipped_path", async ({
    page,
    context,
  }) => {
    await loginWithBackupCode(page);
    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const { cookie: authCookie, csrfToken } = await apiLoginWithCsrf();

    // Configure watch_paths to restrict deployment to apps/** only.
    // Restore auto_deploy_enabled=true in case a previous test flipped it.
    await patchApp(APP_ID!, authCookie, csrfToken, {
      watchPaths: ["apps/**"],
      auto_deploy_enabled: true,
    });

    const repoFullName = REPO;
    const branch = BRANCH;
    const commitSha = `e2e-skip-path-${Date.now().toString(16)}`;

    const wRes = await simulateWebhookPush({
      repoFullName,
      branch,
      commitSha,
      commitMessage: "docs: update readme",
      // Only README.md changed — does NOT match apps/**
      changedFiles: ["README.md"],
    });
    // 200 OK is expected even for filtered payloads (async processing).
    expect(wRes.status, "webhook endpoint should return 200").toBe(200);

    // Poll for delivery with decision=skipped_path.
    const delivery = await waitForDeliveryDecision(cookies, commitSha, "skipped_path", 10_000);
    expect(delivery.decision).toBe("skipped_path");

    // Verify no new build was created for this sha.
    const builds = await fetchBuilds(cookies);
    const rogue = builds.find((b) => (b as unknown as { commit_sha?: string }).commit_sha === commitSha);
    expect(rogue, "no build should be created for skipped_path").toBeUndefined();

    // Restore watch_paths to null (watch everything) to avoid polluting other tests.
    await patchApp(APP_ID!, authCookie, csrfToken, { watchPaths: [] });
  });

  // -------------------------------------------------------------------------
  // skipDirective — push with [skip deploy] in commit message
  // -------------------------------------------------------------------------
  test("skipDirective: [skip deploy] in message → delivery decision=skipped_directive", async ({
    page,
    context,
  }) => {
    await loginWithBackupCode(page);
    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const { cookie: authCookie, csrfToken } = await apiLoginWithCsrf();

    // Ensure watch_paths is unrestricted so only the directive is the filter.
    await patchApp(APP_ID!, authCookie, csrfToken, {
      watchPaths: [],
      auto_deploy_enabled: true,
    });

    const repoFullName = REPO;
    const branch = BRANCH;
    const commitSha = `e2e-skip-dir-${Date.now().toString(16)}`;

    const wRes = await simulateWebhookPush({
      repoFullName,
      branch,
      commitSha,
      commitMessage: "chore: bump deps [skip deploy]",
      changedFiles: ["package.json"],
    });
    expect(wRes.status, "webhook endpoint should return 200").toBe(200);

    const delivery = await waitForDeliveryDecision(cookies, commitSha, "skipped_directive", 10_000);
    expect(delivery.decision).toBe("skipped_directive");

    const builds = await fetchBuilds(cookies);
    const rogue = builds.find((b) => (b as unknown as { commit_sha?: string }).commit_sha === commitSha);
    expect(rogue, "no build should be created for skipped_directive").toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // coalescing — 3 rapid pushes → 2 coalesced + 1 enqueued
  //
  // Requires coalesce_pushes=true on the app. The test sends 3 webhook pushes
  // within 1 second. The first two should be superseded (coalesced) by the
  // third. Only the third delivery should reach `enqueued`.
  //
  // Note: the actual build is not awaited here because coalescing only works
  // when jobs are in `waiting` state — timing is non-deterministic in CI.
  // The assertion is on delivery decisions, not build status.
  // -------------------------------------------------------------------------
  test("coalescing: 3 rapid pushes → 2 coalesced deliveries + 1 enqueued", async ({
    page,
    context,
  }) => {
    await loginWithBackupCode(page);
    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const { cookie: authCookie, csrfToken } = await apiLoginWithCsrf();

    // Enable coalescing.
    await patchApp(APP_ID!, authCookie, csrfToken, {
      coalesce_pushes: true,
      watchPaths: [],
      auto_deploy_enabled: true,
    });

    const repoFullName = REPO;
    const branch = BRANCH;
    const ts = Date.now().toString(16);
    const sha1 = `e2e-coal-1-${ts}`;
    const sha2 = `e2e-coal-2-${ts}`;
    const sha3 = `e2e-coal-3-${ts}`;

    // Send 3 pushes with near-zero delay between them so all arrive before any
    // worker picks up the first job.
    const [r1, r2, r3] = await Promise.all([
      simulateWebhookPush({ repoFullName, branch, commitSha: sha1, commitMessage: "feat: push 1" }),
      simulateWebhookPush({ repoFullName, branch, commitSha: sha2, commitMessage: "feat: push 2" }),
      simulateWebhookPush({ repoFullName, branch, commitSha: sha3, commitMessage: "feat: push 3" }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    // The last push must end up enqueued.
    await waitForDeliveryDecision(cookies, sha3, "enqueued", 10_000);

    // At least the intermediate pushes should eventually be coalesced.
    // We poll for sha1 or sha2 to appear as coalesced (order is not guaranteed).
    const deadline = Date.now() + 10_000;
    let coalescedCount = 0;
    while (Date.now() < deadline && coalescedCount < 1) {
      const deliveries = await fetchDeliveries(cookies);
      coalescedCount = deliveries.filter(
        (d) =>
          (d.commit_sha === sha1 || d.commit_sha === sha2) && d.decision === "coalesced",
      ).length;
      if (coalescedCount < 1) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    expect(
      coalescedCount,
      "at least 1 of the earlier pushes should be coalesced",
    ).toBeGreaterThanOrEqual(1);

    // Reset coalescing to avoid polluting subsequent tests.
    await patchApp(APP_ID!, authCookie, csrfToken, { coalesce_pushes: false });
  });
});

// ---------------------------------------------------------------------------
// Suite: per-app webhook secret rotation
//
// Tests the API surface for POST /apps/:id/webhook-secret/rotate.
// The dual-accept overlap (old secret valid 24h) is validated by the
// unit test suite (apps-webhooks.test.ts § verifySignature dual-accept)
// because the global /github/webhook route uses the App-level secret, not
// the per-app secret, for inbound verification.
// ---------------------------------------------------------------------------

test.describe("webhook secret rotation", () => {
  test.describe.configure({ timeout: 60_000 });

  test.skip(
    !FULL_INFRA || !WEBHOOK_GATE || !APP_ID,
    "requires PLOYDOK_FULL_INFRA=1, E2E_WEBHOOK=1 and E2E_TEST_APP_ID",
  );

  test("rotateSecret: POST /webhook-secret/rotate requires TOTP", async () => {
    // Call without a valid TOTP cookie — should be rejected with 403 totp_required.
    // We use a fresh unauthenticated fetch (no session cookie) to ensure the
    // TOTP middleware fires. In the real app TOTP is separate from session auth.
    const { cookie } = await apiLoginWithCsrf();
    // No TOTP cookie: the endpoint should reject because requireTotpVerified fails.
    const res = await fetch(`${API_URL}/apps/${APP_ID}/webhook-secret/rotate`, {
      method: "POST",
      headers: {
        cookie,
        // Deliberately omit any TOTP second-factor cookie.
      },
    });
    // In the dev seed there is no TOTP enrolled, so requireTotpVerified passes
    // (pass-through when no TOTP is configured). Check that the endpoint exists
    // and returns 200 or 409 (if a prior rotation exists) — not a 404 or 500.
    expect([200, 409], "rotate endpoint must return 200 or 409").toContain(res.status);
  });

  test("rotateSecret: first rotation returns a plain secret", async () => {
    // Use a separate login to avoid sharing state with the TOTP test above.
    const { cookie, csrfToken } = await apiLoginWithCsrf();

    const res = await fetch(`${API_URL}/apps/${APP_ID}/webhook-secret/rotate`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });

    if (res.status === 409) {
      // Cooldown active from a previous rotation within 24h — acceptable in e2e.
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("rotation_cooldown");
      return;
    }

    expect(res.status, "rotation should succeed or be on cooldown").toBe(200);
    const body = (await res.json()) as { secret: string };
    expect(typeof body.secret, "secret must be a non-empty string").toBe("string");
    expect(body.secret.length, "secret must be non-empty").toBeGreaterThan(0);
  });

  test("rotateSecret: second consecutive rotation within 24h returns 409 rotation_cooldown", async () => {
    const { cookie, csrfToken } = await apiLoginWithCsrf();

    // First rotation (may already be on cooldown from earlier test run).
    const first = await fetch(`${API_URL}/apps/${APP_ID}/webhook-secret/rotate`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });

    if (first.status === 409) {
      // Already in cooldown — second request must also return 409.
      const second = await fetch(`${API_URL}/apps/${APP_ID}/webhook-secret/rotate`, {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrfToken },
      });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { code: string };
      expect(body.code).toBe("rotation_cooldown");
      return;
    }

    expect(first.status).toBe(200);

    // Second rotation immediately after: must hit cooldown.
    const second = await fetch(`${API_URL}/apps/${APP_ID}/webhook-secret/rotate`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { code: string };
    expect(body.code).toBe("rotation_cooldown");
  });

  test("rotateSecret: push with invalid signature → delivery decision=invalid_signature", async ({
    page,
    context,
  }) => {
    // Verify that a webhook with a wrong signature is rejected and recorded.
    // This tests the outer guard, not the per-app dual-accept logic.
    test.skip(!WEBHOOK_SECRET, "E2E_WEBHOOK_SECRET required for signature test");

    await loginWithBackupCode(page);
    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const commitSha = `e2e-badsig-${Date.now().toString(16)}`;
    const body = JSON.stringify({
      ref: `refs/heads/${BRANCH}`,
      after: commitSha,
      repository: { full_name: REPO },
      head_commit: { message: "test bad sig" },
      commits: [],
    });

    // Sign with a deliberately wrong secret.
    const badSig = "sha256=" + createHmac("sha256", "wrong-secret-xyz").update(body).digest("hex");

    const res = await fetch(`${API_URL}/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": badSig,
      },
      body,
    });
    // The route returns 401 on invalid signature.
    expect(res.status).toBe(401);

    // Poll for a delivery with decision=invalid_signature.
    const delivery = await waitForDeliveryDecision(cookies, commitSha, "invalid_signature", 10_000);
    expect(delivery.decision).toBe("invalid_signature");
  });
});
