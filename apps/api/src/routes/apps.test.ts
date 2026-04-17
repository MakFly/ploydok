// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { createDb } from "@ploydok/db";
import { users, projects, apps, builds } from "@ploydok/db";
import { createAppsRouter } from "./apps";
import type { AuthUser } from "../auth/middleware";

// ---------------------------------------------------------------------------
// Test DB helper — in-memory SQLite with all required tables
// ---------------------------------------------------------------------------

function makeTestDb() {
  const db = createDb(":memory:");

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      recovery_token_hash TEXT,
      recovery_expires_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      git_provider TEXT,
      repo_full_name TEXT,
      branch TEXT,
      github_installation_id TEXT,
      root_dir TEXT,
      dockerfile_path TEXT,
      install_command TEXT,
      build_command TEXT,
      start_command TEXT,
      watch_paths TEXT,
      container_id TEXT,
      domain TEXT,
      build_method TEXT DEFAULT 'auto',
      healthcheck_path TEXT DEFAULT '/',
      healthcheck_port INTEGER,
      healthcheck_interval_s INTEGER DEFAULT 5,
      healthcheck_timeout_s INTEGER DEFAULT 3,
      healthcheck_retries INTEGER DEFAULT 6,
      healthcheck_start_period_s INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      build_method TEXT,
      image_tag TEXT,
      container_id TEXT,
      commit_sha TEXT,
      commit_message TEXT,
      log_path TEXT,
      error_message TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_at INTEGER,
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  return db;
}

type TestDb = ReturnType<typeof makeTestDb>;

// ---------------------------------------------------------------------------
// Test fixtures helpers
// ---------------------------------------------------------------------------

async function createTestUser(db: TestDb, overrides: Partial<{ id: string; email: string }> = {}) {
  const id = overrides.id ?? nanoid();
  const now = new Date();
  await db.insert(users).values({
    id,
    email: overrides.email ?? `user-${id}@test.com`,
    display_name: "Test User",
    created_at: now,
    updated_at: now,
    recovery_token_hash: null,
    recovery_expires_at: null,
  });
  return { id, email: overrides.email ?? `user-${id}@test.com` };
}

async function createTestProject(db: TestDb, ownerId: string) {
  const id = nanoid();
  const now = new Date();
  await db.insert(projects).values({
    id,
    owner_id: ownerId,
    name: `Project ${id}`,
    slug: `proj-${id}`,
    created_at: now,
  });
  return { id };
}

interface CreateAppOpts {
  userId: string;
  projectId: string;
  name?: string;
  branch?: string;
}

async function createTestApp(db: TestDb, opts: CreateAppOpts) {
  const id = nanoid();
  const now = new Date();
  const name = opts.name ?? `App ${id}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

  await db.insert(apps).values({
    id,
    project_id: opts.projectId,
    name,
    slug,
    status: "created",
    created_at: now,
    updated_at: now,
    git_provider: "github",
    repo_full_name: "owner/repo",
    branch: opts.branch ?? "main",
    root_dir: null,
    dockerfile_path: null,
    install_command: null,
    build_command: null,
    start_command: null,
    watch_paths: null,
    container_id: null,
    domain: `${slug}.demo.ploydok.local`,
    build_method: "auto",
    healthcheck_path: "/",
    healthcheck_port: null,
    healthcheck_interval_s: 5,
    healthcheck_timeout_s: 3,
    healthcheck_retries: 6,
    healthcheck_start_period_s: 0,
  });
  return { id, slug };
}

// ---------------------------------------------------------------------------
// Test app builder — wraps the apps router with fake auth middleware
// ---------------------------------------------------------------------------

function buildTestApp(db: TestDb, authedUser?: AuthUser): Hono {
  const honoApp = new Hono();

  honoApp.use("*", async (c, next) => {
    if (authedUser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).set("user", authedUser);
    }
    return next();
  });

  const router = createAppsRouter(db);
  honoApp.route("/apps", router);
  return honoApp;
}

function fakeUser(id: string, email: string): AuthUser {
  return { id, email, display_name: "Test User", session_id: "sess-test" };
}

// ---------------------------------------------------------------------------
// POST /apps
// ---------------------------------------------------------------------------

describe("POST /apps", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("creates an app with valid body → 201 + app in response", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "My App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/my-repo",
        branch: "main",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { app: { id: string; slug: string; name: string; status: string; domain: string } };
    expect(body.app.name).toBe("My App");
    expect(body.app.slug).toBe("my-app");
    expect(body.app.status).toBe("created");
    expect(body.app.domain).toBe("my-app.demo.ploydok.local");
    expect(body.app.id).toBeString();
  });

  it("generates slug from name — special chars collapsed", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "  Hello World!! 123  ",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { app: { slug: string } };
    expect(body.app.slug).toBe("hello-world-123");
  });

  it("slug collision within project → appends -2", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`));

    // Create first app
    await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My App", projectId, gitProvider: "github", repoFullName: "o/r", branch: "main" }),
    });

    // Create second app with same name
    const res2 = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My App", projectId, gitProvider: "github", repoFullName: "o/r", branch: "main" }),
    });
    expect(res2.status).toBe(201);
    const body2 = await res2.json() as { app: { slug: string } };
    expect(body2.app.slug).toBe("my-app-2");
  });

  it("projectId belonging to another user → 404", async () => {
    // Create another user's project
    const otherUser = await createTestUser(db);
    const otherProject = await createTestProject(db, otherUser.id);

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bad App",
        projectId: otherProject.id,
        gitProvider: "github",
        repoFullName: "o/r",
        branch: "main",
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("invalid body (missing branch) → 400", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "App",
        projectId,
        gitProvider: "github",
        repoFullName: "o/r",
        // missing branch
      }),
    });
    expect(res.status).toBe(400);
  });

  it("uses provided domain instead of generated one", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Custom Domain App",
        projectId,
        gitProvider: "github",
        repoFullName: "o/r",
        branch: "main",
        domain: "myapp.example.com",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { app: { domain: string } };
    expect(body.app.domain).toBe("myapp.example.com");
  });
});

// ---------------------------------------------------------------------------
// GET /apps
// ---------------------------------------------------------------------------

describe("GET /apps", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("lists only apps belonging to the authenticated user", async () => {
    // Create 2 apps for this user
    await createTestApp(db, { userId, projectId, name: "App Alpha" });
    await createTestApp(db, { userId, projectId, name: "App Beta" });

    // Create another user with their own app
    const other = await createTestUser(db);
    const otherProject = await createTestProject(db, other.id);
    await createTestApp(db, { userId: other.id, projectId: otherProject.id, name: "Other App" });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request("/apps");

    expect(res.status).toBe(200);
    const body = await res.json() as { apps: { name: string }[] };
    expect(body.apps).toHaveLength(2);
    const names = body.apps.map((a) => a.name).sort();
    expect(names).toEqual(["App Alpha", "App Beta"]);
  });

  it("returns empty list when user has no apps", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request("/apps");
    expect(res.status).toBe(200);
    const body = await res.json() as { apps: unknown[] };
    expect(body.apps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /apps/:id
// ---------------------------------------------------------------------------

describe("GET /apps/:id", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("returns app details + builds for the owner", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId, name: "Detail App" });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}`);

    expect(res.status).toBe(200);
    const body = await res.json() as { app: { id: string; name: string }; builds: unknown[] };
    expect(body.app.id).toBe(appId);
    expect(body.app.name).toBe("Detail App");
    expect(Array.isArray(body.builds)).toBe(true);
  });

  it("normalizes nullable optional config fields to undefined", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId, name: "Detail App" });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}`);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      app: {
        rootDir?: string;
        dockerfilePath?: string;
        installCommand?: string;
        buildCommand?: string;
        startCommand?: string;
      };
    };

    expect(body.app.rootDir).toBeUndefined();
    expect(body.app.dockerfilePath).toBeUndefined();
    expect(body.app.installCommand).toBeUndefined();
    expect(body.app.buildCommand).toBeUndefined();
    expect(body.app.startCommand).toBeUndefined();
  });

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db);
    const otherProject = await createTestProject(db, other.id);
    const { id: otherAppId } = await createTestApp(db, { userId: other.id, projectId: otherProject.id });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${otherAppId}`);

    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for a non-existent appId", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /apps/:id
// ---------------------------------------------------------------------------

describe("PATCH /apps/:id", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("updates branch and healthcheck.retries", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId, branch: "main" });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branch: "develop",
        healthcheck: { retries: 10 },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { app: { branch: string; healthcheck: { retries: number } } };
    expect(body.app.branch).toBe("develop");
    expect(body.app.healthcheck.retries).toBe(10);
  });

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db);
    const otherProject = await createTestProject(db, other.id);
    const { id: otherAppId } = await createTestApp(db, { userId: other.id, projectId: otherProject.id });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${otherAppId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch: "hacked" }),
    });

    expect(res.status).toBe(404);
  });

  it("ignores unknown fields (partial update)", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId, branch: "main" });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildMethod: "nixpacks" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { app: { buildMethod: string; branch: string } };
    expect(body.app.buildMethod).toBe("nixpacks");
    expect(body.app.branch).toBe("main"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// DELETE /apps/:id
// ---------------------------------------------------------------------------

describe("DELETE /apps/:id", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("soft-deletes (status=stopped) and returns 204", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}`, { method: "DELETE" });

    expect(res.status).toBe(204);

    // Verify still in DB with status=stopped (hard delete would leave nothing)
    const rows = await db.select().from(apps);
    const found = rows.find((r) => r.id === appId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("stopped");
  });

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db);
    const otherProject = await createTestProject(db, other.id);
    const { id: otherAppId } = await createTestApp(db, { userId: other.id, projectId: otherProject.id });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${otherAppId}`, { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /apps/:id/rollback — with explicit buildId (W2.A)
// ---------------------------------------------------------------------------

async function createTestBuild(
  db: TestDb,
  appId: string,
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled",
  opts: { imageTag?: string; commitSha?: string; commitMessage?: string } = {},
) {
  const id = nanoid();
  const now = new Date();
  const startedAt = new Date(now.getTime() - 60_000);
  await db.insert(builds).values({
    id,
    app_id: appId,
    status,
    build_method: "docker",
    image_tag: opts.imageTag ?? `registry/app:${id}`,
    container_id: null,
    commit_sha: opts.commitSha ?? null,
    commit_message: opts.commitMessage ?? null,
    log_path: null,
    error_message: null,
    started_at: startedAt,
    finished_at: now,
    created_at: now,
  });
  return { id };
}

// ---------------------------------------------------------------------------
// GET /apps/:id/builds — commitMessage exposed in serializeBuild
// ---------------------------------------------------------------------------

describe("GET /apps/:id/builds", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("exposes commitMessage from build row", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });
    await createTestBuild(db, appId, "succeeded", {
      commitSha: "abc1234",
      commitMessage: "feat: add commit message field",
    });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}/builds`);

    expect(res.status).toBe(200);
    const body = await res.json() as { builds: { commitMessage: string | null }[] };
    expect(body.builds).toHaveLength(1);
    expect(body.builds[0]!.commitMessage).toBe("feat: add commit message field");
  });

  it("exposes commitMessage as null when absent", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });
    await createTestBuild(db, appId, "succeeded");

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}/builds`);

    expect(res.status).toBe(200);
    const body = await res.json() as { builds: { commitMessage: string | null }[] };
    expect(body.builds[0]!.commitMessage).toBeNull();
  });
});

describe("POST /apps/:id/rollback", () => {
  let db: TestDb;
  let userId: string;
  let projectId: string;

  // Mock the runner module so lifecycle ops don't try to connect to Docker/agent.
  // All public exports must be listed here to avoid breaking other test files
  // that import from this module in the same bun test run.
  mock.module("../worker/runner.js", () => ({
    rollbackApp: async () => undefined,
    restartApp: async () => undefined,
    stopApp: async () => undefined,
    runBlueGreen: async () => ({ containerId: "mock-ctr", color: "blue" }),
    DeployFailedError: class DeployFailedError extends Error {
      constructor(appId: string, reason: string) {
        super(`DeployFailedError[${appId}]: ${reason}`);
        this.name = "DeployFailedError";
      }
    },
  }));

  beforeEach(async () => {
    db = makeTestDb();
    const user = await createTestUser(db);
    userId = user.id;
    const project = await createTestProject(db, userId);
    projectId = project.id;
  });

  it("rollback with explicit succeeded buildId → 200", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });
    const { id: buildId } = await createTestBuild(db, appId, "succeeded");

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rollback with explicit failed buildId → 400 INVALID_BUILD_STATUS", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });
    const { id: failedBuildId } = await createTestBuild(db, appId, "failed");

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId: failedBuildId }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BUILD_STATUS");
  });

  it("rollback without buildId (legacy) — calls runner and returns 200", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    // No body — legacy behaviour
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
    });

    // Runner mock succeeds — expect 200
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rollback with non-existent buildId → 404", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
  });

  it("rollback for another user's app → 404", async () => {
    const other = await createTestUser(db);
    const otherProject = await createTestProject(db, other.id);
    const { id: otherAppId } = await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
    });

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`));
    const res = await honoApp.request(`/apps/${otherAppId}/rollback`, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});
