// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sprint-3bis — Phase 1.C pentest: cross-project network isolation.
 *
 * Asserts that two apps living in DIFFERENT projects cannot reach each
 * other over the Docker network. Each project owns its own bridge network
 * (`ploydok-proj-<id>`) and containers are only attached to their own
 * project network + the shared `ploydok-ingress` network. A DNS lookup
 * for "app-in-other-project" must fail from inside app A, and a TCP
 * connect must time out or be refused.
 *
 * Gate: requires PLOYDOK_E2E_REAL=1 (agent + docker running on the host).
 * Without that env var the suite is skipped so CI stays green.
 *
 * Required env vars (in addition to auth helpers):
 *   E2E_TEST_PROJECT_A_ID  – existing project id (owner = test user)
 *   E2E_TEST_PROJECT_B_ID  – existing project id (same owner, distinct from A)
 */
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { API_URL, apiLoginWithCsrf } from "../helpers/auth";

// ---------------------------------------------------------------------------
// Gate + env
// ---------------------------------------------------------------------------

const E2E_REAL = process.env.PLOYDOK_E2E_REAL === "1";
const PROJECT_A = process.env.E2E_TEST_PROJECT_A_ID;
const PROJECT_B = process.env.E2E_TEST_PROJECT_B_ID;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CreatedApp {
  id: string;
  slug: string;
  name: string;
  containerName: string;
}

function docker(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync("docker", args, { encoding: "utf8" });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status,
  };
}

interface AuthCtx {
  cookie: string;
  csrfToken: string;
}

async function createImageApp(
  auth: AuthCtx,
  projectId: string,
  name: string,
): Promise<CreatedApp> {
  const res = await fetch(`${API_URL}/apps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: auth.cookie,
      "x-csrf-token": auth.csrfToken,
    },
    body: JSON.stringify({
      name,
      projectId,
      gitProvider: "image",
      imageRef: "nginx:alpine",
      imagePullPolicy: "if_not_present",
      plan: "nano",
      healthcheck: { port: 80, path: "/" },
    }),
  });
  if (!res.ok) {
    throw new Error(`createImageApp(${name}) failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { app: { id: string; slug: string; name: string } };
  const appData = data.app;
  // Mirror `runtimeContainerName` in `apps/api/src/runtime-containers.ts`:
  // `ploydok-app-<slug>-<shortId>-<color>`, shortId = first 8 chars of the
  // sanitized appId. First deploy is always blue.
  const shortId = appData.id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 8);
  return {
    id: appData.id,
    slug: appData.slug,
    name: appData.name,
    containerName: `ploydok-app-${appData.slug}-${shortId}-blue`,
  };
}

async function deploy(auth: AuthCtx, appId: string): Promise<void> {
  const res = await fetch(`${API_URL}/apps/${appId}/deploy`, {
    method: "POST",
    headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
  });
  if (!res.ok) {
    throw new Error(`deploy(${appId}) failed: ${res.status} ${await res.text()}`);
  }
}

async function waitForStatus(
  auth: AuthCtx,
  appId: string,
  target: "running",
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/apps/${appId}`, {
      headers: { cookie: auth.cookie },
    });
    if (res.ok) {
      const data = (await res.json()) as { app: { status: string } };
      if (data.app.status === target) return;
      if (data.app.status === "failed") {
        throw new Error(`App ${appId} failed during deploy`);
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`App ${appId} did not reach '${target}' within ${timeoutMs}ms`);
}

async function cleanup(auth: AuthCtx, appId: string | null): Promise<void> {
  if (!appId) return;
  await fetch(`${API_URL}/apps/${appId}`, {
    method: "DELETE",
    headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
  }).catch(() => {
    /* best-effort */
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("sprint-3bis — cross-project network isolation", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(!E2E_REAL, "requires PLOYDOK_E2E_REAL=1 (agent + docker)");
  test.skip(
    !PROJECT_A || !PROJECT_B,
    "requires E2E_TEST_PROJECT_A_ID and E2E_TEST_PROJECT_B_ID",
  );

  let auth: AuthCtx;
  let appA: CreatedApp | null = null;
  let appB: CreatedApp | null = null;

  test.beforeAll(async () => {
    auth = await apiLoginWithCsrf();
  });

  test.afterAll(async () => {
    await cleanup(auth, appA?.id ?? null);
    await cleanup(auth, appB?.id ?? null);
  });

  test("app-A cannot reach app-B over the Docker network", async () => {
    const suffix = Date.now().toString(36);
    appA = await createImageApp(auth, PROJECT_A!, `iso-a-${suffix}`);
    appB = await createImageApp(auth, PROJECT_B!, `iso-b-${suffix}`);

    await deploy(auth, appA.id);
    await deploy(auth, appB.id);
    await waitForStatus(auth, appA.id, "running", 120_000);
    await waitForStatus(auth, appB.id, "running", 120_000);

    // DNS: wget should fail to resolve app-B from inside app-A (different
    // project networks + different ingress aliases).
    const curl = docker([
      "exec",
      appA.containerName,
      "sh",
      "-c",
      // nginx:alpine has wget, not curl. 3s timeout, quiet, output to stderr.
      `wget --timeout=3 --tries=1 -qO- http://${appB.containerName}:80/ 2>&1 || echo BLOCKED`,
    ]);
    expect(curl.stdout + curl.stderr).toContain("BLOCKED");
    expect(curl.stdout + curl.stderr).not.toContain("<html");

    // Inspect app-B's project network: app-A must NOT be a member.
    const inspect = docker([
      "network",
      "inspect",
      `ploydok-proj-${PROJECT_B!.toLowerCase()}`,
      "--format",
      "{{range .Containers}}{{.Name}} {{end}}",
    ]);
    expect(inspect.status).toBe(0);
    expect(inspect.stdout).not.toContain(appA.containerName);
    expect(inspect.stdout).toContain(appB.containerName);
  });
});
