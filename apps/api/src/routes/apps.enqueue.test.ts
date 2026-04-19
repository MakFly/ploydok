// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { createDb } from "@ploydok/db"
import { users, projects, apps, jobs } from "@ploydok/db"
import { createAppsRouter } from "./apps"
import type { AuthUser } from "../auth/middleware"

// ---------------------------------------------------------------------------
// Test DB helper — mirrors makeTestDb from apps.test.ts, with job_runs added
// ---------------------------------------------------------------------------

function makeTestDb() {
  const db = createDb(":memory:")

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
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `)

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
      restart_policy TEXT NOT NULL DEFAULT 'unless-stopped',
      domain TEXT,
      build_method TEXT DEFAULT 'auto',
      healthcheck_path TEXT DEFAULT '/',
      healthcheck_port INTEGER,
      healthcheck_interval_s INTEGER DEFAULT 5,
      healthcheck_timeout_s INTEGER DEFAULT 3,
      healthcheck_retries INTEGER DEFAULT 6,
      healthcheck_start_period_s INTEGER DEFAULT 0
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      build_method TEXT,
      image_tag TEXT,
      container_id TEXT,
      commit_sha TEXT,
      log_path TEXT,
      error_message TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `)

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
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT
    )
  `)

  return db
}

type TestDb = ReturnType<typeof makeTestDb>

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function createTestUser(
  db: TestDb,
  overrides: Partial<{ id: string; email: string }> = {},
) {
  const id = overrides.id ?? nanoid()
  const email = overrides.email ?? `user-${id}@test.com`
  const now = new Date()
  await db.insert(users).values({
    id,
    email,
    display_name: "Test User",
    created_at: now,
    updated_at: now,
    recovery_token_hash: null,
    recovery_expires_at: null,
  })
  return { id, email }
}

async function createTestProject(db: TestDb, ownerId: string) {
  const id = nanoid()
  const now = new Date()
  await db.insert(projects).values({
    id,
    owner_id: ownerId,
    name: `Project ${id}`,
    slug: `proj-${id}`,
    created_at: now,
  })
  return { id }
}

function fakeUser(id: string, email: string): AuthUser {
  return { id, email, display_name: "Test User", session_id: "sess-test" }
}

function buildTestApp(db: TestDb, authedUser: AuthUser): Hono {
  const honoApp = new Hono()
  honoApp.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", authedUser)
    return next()
  })
  honoApp.route("/apps", createAppsRouter(db))
  return honoApp
}

// ---------------------------------------------------------------------------
// Test 1: POST /apps enqueues a deploy.requested job
// ---------------------------------------------------------------------------

describe("POST /apps — enqueue job", () => {
  let db: TestDb
  let userId: string
  let projectId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    projectId = project.id
  })

  it("enqueues exactly one deploy.requested job with correct payload", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))

    const res = await honoApp.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "test-app",
        projectId,
        gitProvider: "github",
        repoFullName: "foo/bar",
        branch: "main",
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { app: { id: string } }
    const appId = body.app.id
    expect(typeof appId).toBe("string")
    expect(appId.length).toBeGreaterThan(0)

    // Query jobs table directly
    const jobRows = await db.select().from(jobs)
    expect(jobRows).toHaveLength(1)

    const job = jobRows[0]!
    expect(job.type).toBe("deploy.requested")
    expect(job.status).toBe("pending")
    expect(job.attempts).toBe(0)
    expect(JSON.parse(job.payload)).toEqual({ appId, commitSha: null })
  })
})

// ---------------------------------------------------------------------------
// Test 2: POST /apps/:id/deploy enqueues a second job
// ---------------------------------------------------------------------------

describe("POST /apps/:id/deploy — enqueue job", () => {
  let db: TestDb
  let userId: string
  let projectId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    projectId = project.id
  })

  it("returns 202 with jobId and creates a second deploy.requested job", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))

    // First: create the app (enqueues job #1)
    const createRes = await honoApp.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "test-app",
        projectId,
        gitProvider: "github",
        repoFullName: "foo/bar",
        branch: "main",
      }),
    })
    expect(createRes.status).toBe(201)
    const createBody = (await createRes.json()) as { app: { id: string } }
    const appId = createBody.app.id

    // Second: trigger manual deploy (enqueues job #2)
    const deployRes = await honoApp.request(`/apps/${appId}/deploy`, {
      method: "POST",
    })
    expect(deployRes.status).toBe(202)
    const deployBody = (await deployRes.json()) as {
      ok: boolean
      jobId: string
    }
    expect(deployBody.ok).toBe(true)
    expect(typeof deployBody.jobId).toBe("string")
    expect(deployBody.jobId.length).toBeGreaterThan(0)

    // Both jobs must be in the table for the same appId
    const jobRows = await db.select().from(jobs)
    expect(jobRows).toHaveLength(2)
    for (const job of jobRows) {
      expect(job.type).toBe("deploy.requested")
      expect(JSON.parse(job.payload)).toMatchObject({ appId })
    }
  })
})

// ---------------------------------------------------------------------------
// Test 3: POST /apps/:id/deploy returns 404 for unknown app
// ---------------------------------------------------------------------------

describe("POST /apps/:id/deploy — unknown app", () => {
  let db: TestDb
  let userId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
  })

  it("returns 404 and enqueues no job", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))

    const res = await honoApp.request("/apps/does-not-exist/deploy", {
      method: "POST",
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")

    // No job should have been created
    const jobRows = await db.select().from(jobs)
    expect(jobRows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Test 4: POST /apps/:id/deploy returns 404 for another user's app
// ---------------------------------------------------------------------------

describe("POST /apps/:id/deploy — wrong user", () => {
  let db: TestDb
  let userA: { id: string; email: string }
  let userB: { id: string; email: string }
  let appId: string

  beforeEach(async () => {
    db = makeTestDb()
    userA = await createTestUser(db, { email: "a@test.com" })
    userB = await createTestUser(db, { email: "b@test.com" })

    // Create a project + app owned by user A
    const projectA = await createTestProject(db, userA.id)
    const honoA = buildTestApp(db, fakeUser(userA.id, userA.email))
    const createRes = await honoA.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "user-a-app",
        projectId: projectA.id,
        gitProvider: "github",
        repoFullName: "a/repo",
        branch: "main",
      }),
    })
    expect(createRes.status).toBe(201)
    const createBody = (await createRes.json()) as { app: { id: string } }
    appId = createBody.app.id
  })

  it("returns 404 when user B tries to deploy user A's app, and enqueues no extra job", async () => {
    // Drain jobs created during setup (1 job from POST /apps above)
    const setupJobs = await db.select().from(jobs)
    expect(setupJobs).toHaveLength(1)

    // User B attempts to deploy user A's app
    const honoB = buildTestApp(db, fakeUser(userB.id, userB.email))
    const res = await honoB.request(`/apps/${appId}/deploy`, {
      method: "POST",
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")

    // Still only 1 job (the one from POST /apps) — deploy did not enqueue
    const jobRows = await db.select().from(jobs)
    expect(jobRows).toHaveLength(1)
  })
})
