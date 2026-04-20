// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { users, projects, apps, jobs } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { makeTestDb as makePgTestDb, TEST_PG_URL } from "../test/db-helpers"
import { createAppsRouter } from "./apps"
import type { AuthUser } from "../auth/middleware"

// ---------------------------------------------------------------------------
// Test DB helper — mirrors makeTestDb from apps.test.ts, with job_runs added
// ---------------------------------------------------------------------------

const skip = !TEST_PG_URL
if (skip) console.log("[apps.enqueue.test] PLOYDOK_TEST_PG_URL not set — skipping")

async function makeTestDb() {
  const { db } = await makePgTestDb()
  return db
}

type TestDb = Db

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

describe.skipIf(skip)("POST /apps — enqueue job", () => {
  let db: TestDb
  let userId: string
  let projectId: string

  beforeEach(async () => {
    db = await makeTestDb()
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

describe.skipIf(skip)("POST /apps/:id/deploy — enqueue job", () => {
  let db: TestDb
  let userId: string
  let projectId: string

  beforeEach(async () => {
    db = await makeTestDb()
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

describe.skipIf(skip)("POST /apps/:id/deploy — unknown app", () => {
  let db: TestDb
  let userId: string

  beforeEach(async () => {
    db = await makeTestDb()
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

describe.skipIf(skip)("POST /apps/:id/deploy — wrong user", () => {
  let db: TestDb
  let userA: { id: string; email: string }
  let userB: { id: string; email: string }
  let appId: string

  beforeEach(async () => {
    db = await makeTestDb()
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
