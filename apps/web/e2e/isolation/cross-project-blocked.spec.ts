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
import { API_URL, apiLogin } from "../helpers/auth";

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

async function createImageApp(
  cookies: string,
  projectId: string,
  name: string,
): Promise<CreatedApp> {
  const res = await fetch(`${API_URL}/apps`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookies },
    body: JSON.stringify({
      name,
      projectId,
      gitProvider: "image",
      imageRef: "nginx:alpine",
      imagePullPolicy: "if_not_present",
      plan: "nano",
    }),
  });
  if (!res.ok) {
    throw new Error(`createImageApp(${name}) failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string; slug: string; name: string };
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    containerName: `ploydok-app-${data.slug}`,
  };
}

async function deploy(cookies: string, appId: string): Promise<void> {
  const res = await fetch(`${API_URL}/apps/${appId}/deploy`, {
    method: "POST",
    headers: { cookie: cookies },
  });
  if (!res.ok) {
    throw new Error(`deploy(${appId}) failed: ${res.status} ${await res.text()}`);
  }
}

async function waitForStatus(
  cookies: string,
  appId: string,
  target: "running",
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/apps/${appId}`, {
      headers: { cookie: cookies },
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

async function cleanup(cookies: string, appId: string | null): Promise<void> {
  if (!appId) return;
  await fetch(`${API_URL}/apps/${appId}`, {
    method: "DELETE",
    headers: { cookie: cookies },
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

  let cookies: string;
  let appA: CreatedApp | null = null;
  let appB: CreatedApp | null = null;

  test.beforeAll(async () => {
    cookies = await apiLogin();
  });

  test.afterAll(async () => {
    await cleanup(cookies, appA?.id ?? null);
    await cleanup(cookies, appB?.id ?? null);
  });

  test("app-A cannot reach app-B over the Docker network", async () => {
    const suffix = Date.now().toString(36);
    appA = await createImageApp(cookies, PROJECT_A!, `iso-a-${suffix}`);
    appB = await createImageApp(cookies, PROJECT_B!, `iso-b-${suffix}`);

    await deploy(cookies, appA.id);
    await deploy(cookies, appB.id);
    await waitForStatus(cookies, appA.id, "running", 120_000);
    await waitForStatus(cookies, appB.id, "running", 120_000);

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
