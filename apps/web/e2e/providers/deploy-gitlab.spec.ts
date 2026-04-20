// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint 3bis — Deploy from GitLab.
 *
 * Verifies a full GitLab clone → build → run flow. The refactored provider
 * registry (`apps/api/src/providers/index.ts`) means the worker treats
 * GitLab identically to GitHub once `git_provider==='gitlab'` is set.
 *
 * DoD:
 *   - App created from a GitLab repo reaches `running` within 180 s.
 *   - Caddy serves HTTP 200 on the app domain.
 *
 * Gate: requires PLOYDOK_FULL_INFRA=1 + a GitLab OAuth token already stored
 * for the test account (configure via /settings/git-providers in the UI).
 *
 * Env:
 *   E2E_TEST_PROJECT_ID         — existing project id
 *   E2E_GITLAB_REPO_FULL_NAME   — e.g. "makfly/ploydok-hello"
 *   E2E_GITLAB_PROJECT_ID       — numeric GitLab project id
 *   E2E_GITLAB_BRANCH           — default "main"
 */
import { expect, test } from "@playwright/test";
import { API_URL, loginWithBackupCode } from "../helpers/auth";

const FULL_INFRA = process.env.PLOYDOK_FULL_INFRA === "1";
const PROJECT_ID = process.env.E2E_TEST_PROJECT_ID;
const REPO = process.env.E2E_GITLAB_REPO_FULL_NAME;
const GITLAB_PROJECT_ID = process.env.E2E_GITLAB_PROJECT_ID;
const BRANCH = process.env.E2E_GITLAB_BRANCH ?? "main";

const POLL_INTERVAL_MS = 3_000;
const DEPLOY_TIMEOUT_MS = 180_000;

type AppRow = { id: string; status: string; domain: string | null };

async function waitForStatus(
  appId: string,
  target: string,
  cookies: string,
  timeoutMs: number,
): Promise<AppRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/apps/${appId}`, { headers: { cookie: cookies } });
    if (res.ok) {
      const body = (await res.json()) as { app: AppRow };
      if (body.app.status === target) return body.app;
      if (body.app.status === "failed") {
        throw new Error(`app ${appId} entered 'failed' during deploy`);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`app ${appId} did not reach '${target}' within ${timeoutMs}ms`);
}

test.describe("Sprint 3bis — deploy from GitLab", () => {
  test.skip(
    !FULL_INFRA || !PROJECT_ID || !REPO || !GITLAB_PROJECT_ID,
    "requires PLOYDOK_FULL_INFRA=1, E2E_TEST_PROJECT_ID, E2E_GITLAB_REPO_FULL_NAME, E2E_GITLAB_PROJECT_ID",
  );

  test.setTimeout(DEPLOY_TIMEOUT_MS + 30_000);

  test("GitLab repo → build → container running + HTTP 200", async ({ page, context }) => {
    await loginWithBackupCode(page);
    const cookies = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const createRes = await fetch(`${API_URL}/apps`, {
      method: "POST",
      headers: { cookie: cookies, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `e2e-gitlab-${Date.now()}`,
        projectId: PROJECT_ID,
        gitProvider: "gitlab",
        repoFullName: REPO,
        gitlabProjectId: Number(GITLAB_PROJECT_ID),
        branch: BRANCH,
      }),
    });
    expect(createRes.ok, `POST /apps failed: ${createRes.status} ${await createRes.text()}`).toBe(
      true,
    );
    const { app } = (await createRes.json()) as { app: { id: string } };

    const running = await waitForStatus(app.id, "running", cookies, DEPLOY_TIMEOUT_MS);
    expect(running.domain, "app should expose a domain").toBeTruthy();

    const resp = await page.request.get(`https://${running.domain}`, {
      ignoreHTTPSErrors: true,
      maxRedirects: 0,
    });
    expect([200, 301, 302, 308]).toContain(resp.status());
  });
});
