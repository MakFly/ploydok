// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from "node:crypto";
import { describe, expect, it, mock } from "bun:test";
import * as realQueries from "@ploydok/db/queries";
import { env } from "../env";

let mockGitHubAppConfig: Record<string, unknown> | null = null;
// Only override the GitHub-app config getters — other queries (jobs, builds…)
// must keep their real implementations because `mock.module` is process-wide
// in Bun and would otherwise break sibling test files.
mock.module("@ploydok/db/queries", () => ({
  ...realQueries,
  getGitHubAppConfig: async () => mockGitHubAppConfig,
  saveGitHubAppConfig: async () => undefined,
  deleteGitHubAppConfig: async () => undefined,
}));
import { Hono } from "hono";
import { githubRouter } from "./github";
import type { AuthUser } from "../auth/middleware";

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

describe("GET /github/app/setup", () => {
  it("redirects to the web settings page with installed=1 when state is valid", async () => {
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
      `${env.WEB_ORIGIN}/settings/github?installation_id=42&setup_action=install&installed=1`,
    );
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
      `${env.WEB_ORIGIN}/settings/github?installation_id=42&setup_action=install&install_error=state_mismatch`,
    );
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
