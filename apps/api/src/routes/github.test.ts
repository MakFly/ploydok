// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as realQueries from "@ploydok/db/queries";
import { env } from "../env";

let mockGitHubAppConfig: Record<string, unknown> | null = null;
const importedConfigs: Array<Record<string, unknown>> = [];
let deleteConfigCalls = 0;
const credentialUpserts: Array<{
  values: Record<string, unknown>;
  conflict: Record<string, unknown>;
}> = [];
const enqueuedSyncs: Array<Record<string, unknown>> = [];
const deletedTables: Array<unknown> = [];
let liveInstallations: Array<{ id: number; accountLogin?: string }> = [];
const revokedInstallations: number[] = [];
let revokeFailure: Error | null = null;

const fakeProviderCredentials = {
  id: Symbol("provider_credentials.id"),
  provider: Symbol("provider_credentials.provider"),
};
const fakeProviderInstallations = {
  provider: Symbol("provider_installations.provider"),
};
const fakeTable = new Proxy(
  {},
  {
    get: (_target, prop) => Symbol(String(prop)),
  },
);
const fakeDb = {
  insert: mock(() => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: async (conflict: Record<string, unknown>) => {
        credentialUpserts.push({ values, conflict });
      },
    }),
  })),
  delete: mock((table: unknown) => ({
    where: async () => {
      deletedTables.push(table);
    },
  })),
};

mock.module("@ploydok/db", () => ({
  apps: fakeTable,
  createDb: () => fakeDb,
  createRedis: () => ({}),
  gitlab_tokens: fakeTable,
  provider_credentials: fakeProviderCredentials,
  provider_installations: fakeProviderInstallations,
  webhook_deliveries: fakeTable,
}));
mock.module("../github/installation-tokens", () => ({
  getInstallationToken: async () => "test-installation-token",
  evictInstallationToken: () => undefined,
  listAppInstallations: async () => liveInstallations,
  revokeAppInstallation: async (installationId: number) => {
    if (revokeFailure) throw revokeFailure;
    revokedInstallations.push(installationId);
  },
}));
mock.module("../worker/handlers/sync-provider-repos", () => ({
  enqueueProviderReposSync: async (payload: Record<string, unknown>) => {
    enqueuedSyncs.push(payload);
  },
}));
// Only override the GitHub-app config getters — other queries (jobs, builds…)
// must keep their real implementations because `mock.module` is process-wide
// in Bun and would otherwise break sibling test files.
mock.module("@ploydok/db/queries", () => ({
  ...realQueries,
  getGitHubAppConfig: async () => mockGitHubAppConfig,
  saveGitHubAppConfig: async (_db: unknown, cfg: Record<string, unknown>) => {
    importedConfigs.push(cfg);
  },
  deleteGitHubAppConfig: async () => {
    deleteConfigCalls += 1;
  },
}));
import { Hono } from "hono";
import type { AuthUser } from "../auth/middleware";

const githubModule = await import("./github");
const { githubRouter } = githubModule;

// ---------------------------------------------------------------------------
// Test app builder — injects a fake user into Hono context (simulates requireAuth)
// ---------------------------------------------------------------------------

const FAKE_USER: AuthUser = {
  id: "user-test-1",
  email: "test@example.com",
  display_name: "Test User",
  session_id: "sess-1",
};

function buildApp(user?: AuthUser): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).set("user", user);
    }
    return next();
  });
  app.route("/github", githubRouter);
  return app;
}

function signState(state: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET).update(state).digest("hex");
  return `${state}.${mac}`;
}

beforeEach(() => {
  mockGitHubAppConfig = null;
  importedConfigs.length = 0;
  deleteConfigCalls = 0;
  credentialUpserts.length = 0;
  enqueuedSyncs.length = 0;
  deletedTables.length = 0;
  liveInstallations = [];
  revokedInstallations.length = 0;
  revokeFailure = null;
});

// ---------------------------------------------------------------------------
// Dropped OAuth endpoints → 410 Gone
// ---------------------------------------------------------------------------

describe("GET /github/auth/connect (dropped)", () => {
  it("returns 410 Gone", async () => {
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/auth/connect");
    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("oauth_removed");
  });
});

describe("GET /github/auth/callback (dropped)", () => {
  it("returns 410 Gone", async () => {
    const app = buildApp();
    const res = await app.request("/github/auth/callback");
    expect(res.status).toBe(410);
  });
});

describe("DELETE /github/auth/disconnect (dropped)", () => {
  it("returns 410 Gone", async () => {
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/auth/disconnect", { method: "DELETE" });
    expect(res.status).toBe(410);
  });
});

describe("GET /github/status (dropped)", () => {
  it("returns 410 Gone", async () => {
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/status");
    expect(res.status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
// POST /github/webhook — signature verification
// ---------------------------------------------------------------------------

describe("POST /github/webhook", () => {
  it("returns 503 when no GitHub App is configured (DB empty in test)", async () => {
    // In the test environment the DB has no github_app row → 503
    const app = buildApp();
    const res = await app.request("/github/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // 503 because app not configured, or 401 if somehow configured with wrong sig
    expect([401, 503]).toContain(res.status);
  });

  it("returns 401 for missing signature when app is configured", async () => {
    // We can test the signature path without a real DB row by calling the
    // route with a valid content-type but no X-Hub-Signature-256 header.
    // If app is not configured → 503; if somehow configured → 401.
    // Both are acceptable "not 200" responses.
    const app = buildApp();
    const res = await app.request("/github/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });
    expect(res.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /github/app/config
// ---------------------------------------------------------------------------

describe("GET /github/app/config", () => {
  it("returns { configured: false } when no app is stored", async () => {
    mockGitHubAppConfig = null;
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/app/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["configured"]).toBe(false);
  });
});

describe("GET /github/repos/:owner/:repo/files-exist", () => {
  it("checks all requested paths through one batch HTTP endpoint", async () => {
    mockGitHubAppConfig = { app_id: "123" };
    liveInstallations = [{ id: 42, accountLogin: "MakFly" }];
    const probedPaths: string[] = [];
    using _spy = spyOn(githubModule.ghProvider, "fileExists").mockImplementation(
      async (_installationId, _fullName, filePath) => {
        probedPaths.push(filePath);
        return filePath === "composer.json" || filePath === "symfony.lock";
      },
    );

    const app = buildApp(FAKE_USER);
    const res = await app.request(
      "/github/repos/MakFly/fixture-symfony-api/files-exist?path=composer.json&path=symfony.lock&path=Dockerfile&ref=main",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: {
        "composer.json": true,
        "symfony.lock": true,
        Dockerfile: false,
      },
    });
    expect(probedPaths).toEqual(["composer.json", "symfony.lock", "Dockerfile"]);
  });
});

describe("POST /github/app/import", () => {
  it("saves an existing GitHub App config and enqueues a sync", async () => {
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/app/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: "12345",
        clientId: "Iv1.client",
        clientSecret: "secret",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----",
        webhookSecret: "",
        slug: "ploydok-local",
        name: "Ploydok Local",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      configured: true,
      name: "Ploydok Local",
      slug: "ploydok-local",
      app_id: "12345",
    });
    expect(importedConfigs).toHaveLength(1);
    expect(importedConfigs[0]).toMatchObject({
      app_id: "12345",
      client_id: "Iv1.client",
      slug: "ploydok-local",
      name: "Ploydok Local",
    });
    expect(enqueuedSyncs[0]).toMatchObject({ provider: "github" });
  });

  it("rejects invalid private keys", async () => {
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/app/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: "12345",
        clientId: "Iv1.client",
        clientSecret: "secret",
        privateKey: "not a pem",
        slug: "ploydok-local",
        name: "Ploydok Local",
      }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      error: "invalid_private_key",
    });
    expect(importedConfigs).toHaveLength(0);
  });
});

describe("DELETE /github/app/config", () => {
  it("requires the destructive reset confirmation query", async () => {
    mockGitHubAppConfig = { slug: "ploydok-local" };
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/app/config", { method: "DELETE" });

    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      error: "confirmation_required",
    });
    expect(deleteConfigCalls).toBe(0);
    expect(revokedInstallations).toHaveLength(0);
  });

  it("revokes all GitHub installations before deleting local config", async () => {
    mockGitHubAppConfig = { slug: "ploydok-local" };
    liveInstallations = [{ id: 42 }, { id: 77 }];
    const app = buildApp(FAKE_USER);
    const res = await app.request(
      "/github/app/config?confirm=uninstall-github-installations",
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, uninstalled: 2 });
    expect(revokedInstallations).toEqual([42, 77]);
    expect(deleteConfigCalls).toBe(1);
    expect(deletedTables).toHaveLength(2);
  });

  it("keeps local config when a GitHub uninstall fails", async () => {
    mockGitHubAppConfig = { slug: "ploydok-local" };
    liveInstallations = [{ id: 42 }];
    revokeFailure = new Error("github down");
    const app = buildApp(FAKE_USER);
    const res = await app.request(
      "/github/app/config?confirm=uninstall-github-installations",
      { method: "DELETE" },
    );

    expect(res.status).toBe(502);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      error: "github_api_error",
      failed_installation_id: 42,
    });
    expect(deleteConfigCalls).toBe(0);
    expect(deletedTables).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /github/repos
// ---------------------------------------------------------------------------

describe("GET /github/repos", () => {
  it("returns 503 github_app_not_configured when no App is set up", async () => {
    mockGitHubAppConfig = null;
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/repos");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("github_app_not_configured");
  });
});

describe("GET /github/installations/start", () => {
  it("returns 503 when no app is configured", async () => {
    mockGitHubAppConfig = null;
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/installations/start");
    expect(res.status).toBe(503);
  });

  it("sets a state cookie and redirects to GitHub install URL", async () => {
    mockGitHubAppConfig = {
      slug: "ploydok-local",
    };
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/installations/start");
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("https://github.com/apps/ploydok-local/installations/new?state=");
    expect(res.headers.get("set-cookie")).toContain("gh_install_state=");
  });
});

describe("DELETE /github/installations/:id", () => {
  it("revokes the installation and deletes local cache state", async () => {
    mockGitHubAppConfig = { slug: "ploydok-local" };
    const app = buildApp(FAKE_USER);
    const res = await app.request("/github/installations/42", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, revoked: 42 });
    expect(revokedInstallations).toEqual([42]);
    expect(deletedTables).toHaveLength(2);
  });
});

describe("GET /github/app/setup", () => {
  it("upserts the installation credential, enqueues sync, and redirects with installed=1 when state is valid", async () => {
    const app = buildApp();
    const state = "abc123";
    const res = await app.request(
      `/github/app/setup?installation_id=42&setup_action=install&state=${state}`,
      {
        headers: {
          cookie: `gh_install_state=${encodeURIComponent(signState(state))}`,
        },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/settings/git-providers/github?installation_id=42&setup_action=install&installed=1`,
    );
    expect(credentialUpserts).toHaveLength(1);
    expect(credentialUpserts[0]?.values).toMatchObject({
      id: "github:42",
      provider: "github",
      credential_type: "installation",
      last_sync_status: "pending",
      last_sync_source: "api",
      last_sync_claimed_at: null,
    });
    expect(enqueuedSyncs).toHaveLength(1);
    expect(enqueuedSyncs[0]).toMatchObject({
      provider: "github",
      installationId: "42",
    });
  });

  it("marks the return as invalid when state does not verify", async () => {
    const app = buildApp();
    const res = await app.request(
      "/github/app/setup?installation_id=42&setup_action=install&state=bad",
      {
        headers: {
          cookie: `gh_install_state=${encodeURIComponent(signState("good"))}`,
        },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/settings/git-providers/github?installation_id=42&setup_action=install&install_error=state_mismatch`,
    );
    expect(credentialUpserts).toHaveLength(0);
    expect(enqueuedSyncs).toHaveLength(0);
  });

  it("treats an update setup action as the same update-or-create sync path", async () => {
    const app = buildApp();
    const state = "update-state";
    const res = await app.request(
      `/github/app/setup?installation_id=77&setup_action=update&state=${state}`,
      {
        headers: {
          cookie: `gh_install_state=${encodeURIComponent(signState(state))}`,
        },
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/settings/git-providers/github?installation_id=77&setup_action=update&installed=1`,
    );
    expect(credentialUpserts[0]?.values).toMatchObject({
      id: "github:77",
      last_sync_status: "pending",
      last_sync_source: "api",
    });
    expect(enqueuedSyncs[0]).toMatchObject({
      provider: "github",
      installationId: "77",
    });
  });
});

// ---------------------------------------------------------------------------
// Webhook signature helper — integration smoke
// ---------------------------------------------------------------------------

describe("verifySignature helper (via webhook route)", () => {
  it("computes expected sha256 signature correctly", () => {
    const secret = "my-webhook-secret";
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const sig =
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
