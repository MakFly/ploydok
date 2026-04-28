// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { eq } from "drizzle-orm"
import {
  users,
  projects,
  memberships,
  passkeys,
  apps,
  builds,
  secrets,
  app_delete_jobs,
} from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { makeTestDb as makePgTestDb, TEST_PG_URL } from "../test/db-helpers"
import {
  createAppsRouter,
  deriveCurrentBuildMetadata,
  enqueueAppDeleteJob,
} from "./apps"
import type { AuthUser } from "../auth/middleware"
import * as singletons from "../debug/singletons"
import * as githubModule from "./github"
import { decryptSecret } from "../secrets/crypto"

// ---------------------------------------------------------------------------
// Test DB helper — in-memory SQLite with all required tables
// ---------------------------------------------------------------------------

const skip = !TEST_PG_URL
if (skip) console.log("[apps.test] PLOYDOK_TEST_PG_URL not set — skipping")

async function makeTestDb() {
  const { db } = await makePgTestDb()
  return db
}

type TestDb = Db

describe("deriveCurrentBuildMetadata", () => {
  it("uses the latest successful build commit as the current deployed commit", () => {
    const metadata = deriveCurrentBuildMetadata([
      { id: "failed-newer", status: "failed", commit_sha: "badbeef" },
      { id: "success", status: "succeeded", commit_sha: "abc123def456" },
      { id: "older", status: "succeeded", commit_sha: "older" },
    ])

    expect(metadata).toEqual({
      currentCommitSha: "abc123def456",
      latestBuildId: "failed-newer",
    })
  })

  it("supports succeeded_with_warning builds as deployed commits", () => {
    const metadata = deriveCurrentBuildMetadata([
      {
        id: "warning",
        status: "succeeded_with_warning",
        commit_sha: "warn123",
      },
    ])

    expect(metadata.currentCommitSha).toBe("warn123")
  })
})

// ---------------------------------------------------------------------------
// Test fixtures helpers
// ---------------------------------------------------------------------------

async function createTestUser(
  db: TestDb,
  overrides: Partial<{ id: string; email: string }> = {}
) {
  const id = overrides.id ?? nanoid()
  const now = new Date()
  await db.insert(users).values({
    id,
    email: overrides.email ?? `user-${id}@test.com`,
    display_name: "Test User",
    created_at: now,
    updated_at: now,
    recovery_token_hash: null,
    recovery_expires_at: null,
  })
  await db.insert(passkeys).values([
    {
      id: nanoid(),
      user_id: id,
      credential_id: `cred-${id}-1`,
      public_key: Buffer.from("test-public-key-1"),
      counter: 0,
      transports: "[]",
      device_name: "Test passkey 1",
      created_at: now,
      last_used_at: now,
    },
    {
      id: nanoid(),
      user_id: id,
      credential_id: `cred-${id}-2`,
      public_key: Buffer.from("test-public-key-2"),
      counter: 0,
      transports: "[]",
      device_name: "Test passkey 2",
      created_at: now,
      last_used_at: now,
    },
  ])
  return { id, email: overrides.email ?? `user-${id}@test.com` }
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
  await db.insert(memberships).values({
    id: nanoid(),
    org_id: id,
    user_id: ownerId,
    role: "owner",
    invited_by: null,
    invited_at: now,
    accepted_at: now,
  })
  return { id }
}

interface CreateAppOpts {
  userId: string
  projectId: string
  name?: string
  branch?: string
}

async function createTestApp(db: TestDb, opts: CreateAppOpts) {
  const id = nanoid()
  const now = new Date()
  const name = opts.name ?? `App ${id}`
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)

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
    restart_policy: "unless-stopped",
    domain: `${slug}.demo.ploydok.local`,
    build_method: "auto",
    healthcheck_path: "/",
    healthcheck_port: null,
    healthcheck_interval_s: 5,
    healthcheck_timeout_s: 3,
    healthcheck_retries: 6,
    healthcheck_start_period_s: 0,
  })
  return { id, slug }
}

// ---------------------------------------------------------------------------
// Test app builder — wraps the apps router with fake auth middleware
// ---------------------------------------------------------------------------

function buildTestApp(db: TestDb, authedUser?: AuthUser): Hono {
  const honoApp = new Hono()

  honoApp.use("*", async (c, next) => {
    if (authedUser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", authedUser)
    }
    return next()
  })

  const router = createAppsRouter(db)
  honoApp.route("/apps", router)
  return honoApp
}

function fakeUser(id: string, email: string): AuthUser {
  return { id, email, display_name: "Test User", session_id: "sess-test" }
}

describe("enqueueAppDeleteJob", () => {
  it("commits app_delete_jobs before queue.add claims the job", async () => {
    const calls: string[] = []
    let activeTransactions = 0

    const makeTx = (phase: number) => ({
      update: mock((_table: unknown) => ({
        set: mock((values: unknown) => ({
          where: mock(async () => {
            calls.push(
              `tx${phase}:update:${(values as { status?: string }).status ?? "unknown"}`
            )
            return []
          }),
        })),
      })),
      insert: mock((_table: unknown) => ({
        values: mock(async (values: unknown) => {
          calls.push(
            `tx${phase}:insert:${(values as { id?: string }).id ?? "unknown"}`
          )
          return []
        }),
      })),
      delete: mock((_table: unknown) => ({
        where: mock(async () => {
          calls.push(`tx${phase}:delete`)
          return []
        }),
      })),
    })

    const db = {
      transaction: mock(async (callback) => {
        const phase = calls.filter((c) => c.endsWith(":start")).length + 1
        calls.push(`tx${phase}:start`)
        activeTransactions++
        try {
          const result = await callback(makeTx(phase) as unknown as Db)
          calls.push(`tx${phase}:commit`)
          return result
        } finally {
          activeTransactions--
        }
      }),
    } as unknown as Db

    const queue = {
      add: mock(
        async (
          _name: string,
          payload: { jobId: string },
          opts?: { jobId?: string }
        ) => {
          calls.push(`queue:add:${activeTransactions}`)
          const jobId = opts?.jobId ?? "missing-job-id"
          expect(payload.jobId).toBe(jobId)
          return { id: jobId }
        }
      ),
    }

    const result = await enqueueAppDeleteJob({
      db,
      appId: "app-1",
      requestedByUserId: "user-1",
      previousStatus: "running",
      flags: {
        deleteImages: true,
        dockerCleanup: true,
        deleteBuildArtifacts: true,
        deleteCaddyRoutes: true,
      },
      queue,
    })

    expect(result.jobId).toBeString()
    expect(calls[0]).toBe("tx1:start")
    expect(calls[1]).toBe("tx1:update:deleting")
    expect(calls[2]?.startsWith("tx1:insert:")).toBe(true)
    expect(calls[3]).toBe("tx1:commit")
    expect(calls[4]).toBe("queue:add:0")
  })

  it("restores the app row when queue.add fails after commit", async () => {
    const calls: string[] = []
    const appUpdates: Array<{
      phase: number
      values: Record<string, unknown>
    }> = []

    const makeTx = (phase: number) => ({
      update: mock((table: unknown) => ({
        set: mock((values: Record<string, unknown>) => ({
          where: mock(async () => {
            if (table === apps) appUpdates.push({ phase, values })
            calls.push(
              `tx${phase}:update:${String(values.status ?? "unknown")}`
            )
            return []
          }),
        })),
      })),
      insert: mock((_table: unknown) => ({
        values: mock(async (values: unknown) => {
          calls.push(
            `tx${phase}:insert:${(values as { id?: string }).id ?? "unknown"}`
          )
          return []
        }),
      })),
      delete: mock((_table: unknown) => ({
        where: mock(async () => {
          calls.push(`tx${phase}:delete`)
          return []
        }),
      })),
    })

    const db = {
      transaction: mock(async (callback) => {
        const phase = calls.filter((c) => c.endsWith(":start")).length + 1
        calls.push(`tx${phase}:start`)
        const result = await callback(makeTx(phase) as unknown as Db)
        calls.push(`tx${phase}:commit`)
        return result
      }),
    } as unknown as Db

    const queue = {
      add: mock(async () => {
        calls.push("queue:add")
        throw new Error("queue down")
      }),
    }

    await expect(
      enqueueAppDeleteJob({
        db,
        appId: "app-1",
        requestedByUserId: "user-1",
        previousStatus: "running",
        flags: {
          deleteImages: true,
          dockerCleanup: true,
          deleteBuildArtifacts: true,
          deleteCaddyRoutes: true,
        },
        queue,
      })
    ).rejects.toThrow("queue down")

    expect(calls).toContain("tx2:delete")
    expect(calls).toContain("tx2:update:running")
    expect(appUpdates).toEqual([
      expect.objectContaining({
        phase: 1,
        values: expect.objectContaining({ status: "deleting" }),
      }),
      expect.objectContaining({
        phase: 2,
        values: expect.objectContaining({ status: "running" }),
      }),
    ])
  })
})

// ---------------------------------------------------------------------------
// POST /apps
// ---------------------------------------------------------------------------

describe.skipIf(skip)("POST /apps", () => {
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

  it("creates an app with valid body → 201 + app in response", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
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
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      app: {
        id: string
        slug: string
        name: string
        status: string
        domain: string
        restartPolicy: string
      }
    }
    expect(body.app.name).toBe("My App")
    expect(body.app.slug).toBe("my-app")
    expect(body.app.status).toBe("pending")
    expect(body.app.domain).toBe("my-app.demo.ploydok.local")
    expect(body.app.restartPolicy).toBe("unless-stopped")
    expect(body.app.id).toBeString()
  })

  it("creates an app with an explicit restart policy", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Policy App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
        restartPolicy: "no",
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { app: { restartPolicy: string } }
    expect(body.app.restartPolicy).toBe("no")
  })

  it("creates an app with runtime port and nixpacks metadata", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Framework App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
        runtimePort: 4321,
        nixpacksConfigPath: "nixpacks.toml",
        nodeVersion: "22",
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      app: {
        runtimePort: number | null
        nixpacksConfigPath?: string
        nodeVersion?: string
      }
    }
    expect(body.app.runtimePort).toBe(4321)
    expect(body.app.nixpacksConfigPath).toBe("nixpacks.toml")
    expect(body.app.nodeVersion).toBe("22")
  })

  it("rejects rootDir traversal at creation time", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Traversal App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
        rootDir: "../..",
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: { code: string; message: string }
    }
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.message).toContain("safe relative path")
  })

  it("creates controlled initial secrets before first deploy enqueue", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Seeded Laravel",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/laravel-repo",
        branch: "main",
        buildMethod: "nixpacks",
        initialSecrets: [
          {
            key: "PLOYDOK_LARAVEL_SEED",
            value: "true",
            scope: "shared",
            phase: "runtime",
          },
          {
            key: "APP_ENV",
            value: "prod",
            scope: "shared",
            phase: "runtime",
          },
        ],
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { app: { id: string } }
    const rows = await db
      .select({
        key: secrets.key,
        scope: secrets.scope,
        phase: secrets.phase,
      })
      .from(secrets)
      .where(eq(secrets.app_id, body.app.id))

    expect(rows).toContainEqual({
      key: "PLOYDOK_LARAVEL_SEED",
      scope: "shared",
      phase: "runtime",
    })
    expect(rows).toContainEqual({
      key: "APP_ENV",
      scope: "shared",
      phase: "runtime",
    })
  })

  it("generates slug from name — special chars collapsed", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
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
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { app: { slug: string } }
    expect(body.app.slug).toBe("hello-world-123")
  })

  it("slug collision within project → appends -2", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))

    // Create first app
    await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "My App",
        projectId,
        gitProvider: "github",
        repoFullName: "o/r",
        branch: "main",
      }),
    })

    // Create second app with same name
    const res2 = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "My App",
        projectId,
        gitProvider: "github",
        repoFullName: "o/r",
        branch: "main",
      }),
    })
    expect(res2.status).toBe(201)
    const body2 = (await res2.json()) as { app: { slug: string } }
    expect(body2.app.slug).toBe("my-app-2")
  })

  it("projectId belonging to another user → 404", async () => {
    // Create another user's project
    const otherUser = await createTestUser(db)
    const otherProject = await createTestProject(db, otherUser.id)

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
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
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")
  })

  it("invalid body (missing branch) → 400", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
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
    })
    expect(res.status).toBe(400)
  })

  it("uses provided domain instead of generated one", async () => {
    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
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
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { app: { domain: string } }
    expect(body.app.domain).toBe("myapp.example.com")
  })
})

// ---------------------------------------------------------------------------
// GET /apps
// ---------------------------------------------------------------------------

describe.skipIf(skip)("GET /apps", () => {
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

  it("lists only apps belonging to the authenticated user", async () => {
    // Create 2 apps for this user
    await createTestApp(db, { userId, projectId, name: "App Alpha" })
    await createTestApp(db, { userId, projectId, name: "App Beta" })

    // Create another user with their own app
    const other = await createTestUser(db)
    const otherProject = await createTestProject(db, other.id)
    await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
      name: "Other App",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request("/apps")

    expect(res.status).toBe(200)
    const body = (await res.json()) as { apps: { name: string }[] }
    expect(body.apps).toHaveLength(2)
    const names = body.apps.map((a) => a.name).sort()
    expect(names).toEqual(["App Alpha", "App Beta"])
  })

  it("returns empty list when user has no apps", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request("/apps")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { apps: unknown[] }
    expect(body.apps).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GET /apps/:id
// ---------------------------------------------------------------------------

describe.skipIf(skip)("GET /apps/:id", () => {
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

  it("returns app details + builds for the owner", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      name: "Detail App",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      app: { id: string; name: string }
      builds: unknown[]
    }
    expect(body.app.id).toBe(appId)
    expect(body.app.name).toBe("Detail App")
    expect(Array.isArray(body.builds)).toBe(true)
  })

  it("normalizes nullable optional config fields to undefined", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      name: "Detail App",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      app: {
        rootDir?: string
        dockerfilePath?: string
        installCommand?: string
        buildCommand?: string
        startCommand?: string
      }
    }

    expect(body.app.rootDir).toBeUndefined()
    expect(body.app.dockerfilePath).toBeUndefined()
    expect(body.app.installCommand).toBeUndefined()
    expect(body.app.buildCommand).toBeUndefined()
    expect(body.app.startCommand).toBeUndefined()
  })

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db)
    const otherProject = await createTestProject(db, other.id)
    const { id: otherAppId } = await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${otherAppId}`)

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")
  })

  it("returns 404 for a non-existent appId", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/nonexistent-id`)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /apps/:id
// ---------------------------------------------------------------------------

describe.skipIf(skip)("PATCH /apps/:id", () => {
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

  it("updates branch, restartPolicy and healthcheck.retries", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      branch: "main",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branch: "develop",
        restartPolicy: "on-failure",
        healthcheck: { retries: 10 },
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      app: {
        branch: string
        restartPolicy: string
        healthcheck: { retries: number }
      }
    }
    expect(body.app.branch).toBe("develop")
    expect(body.app.restartPolicy).toBe("on-failure")
    expect(body.app.healthcheck.retries).toBe(10)
  })

  it("updates runtime port and nixpacks metadata", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      branch: "main",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimePort: 8080,
        nixpacksConfigPath: "deploy/nixpacks.toml",
        nodeVersion: "20",
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      app: {
        runtimePort: number | null
        nixpacksConfigPath?: string
        nodeVersion?: string
      }
    }
    expect(body.app.runtimePort).toBe(8080)
    expect(body.app.nixpacksConfigPath).toBe("deploy/nixpacks.toml")
    expect(body.app.nodeVersion).toBe("20")
  })

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db)
    const otherProject = await createTestProject(db, other.id)
    const { id: otherAppId } = await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${otherAppId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch: "hacked" }),
    })

    expect(res.status).toBe(404)
  })

  it("ignores unknown fields (partial update)", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      branch: "main",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildMethod: "nixpacks" }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      app: { buildMethod: string; branch: string }
    }
    expect(body.app.buildMethod).toBe("nixpacks")
    expect(body.app.branch).toBe("main") // unchanged
  })

  it("rejects dockerfilePath traversal on patch", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      branch: "main",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dockerfilePath: "/etc/passwd" }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: { code: string; message: string }
    }
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.message).toContain("safe relative path")
  })

  it("blocks patch when PAT-style scopes only grant apps:read", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      branch: "main",
    })

    const scopedUser: AuthUser = {
      ...fakeUser(userId, `u@t.com`),
      token_scopes: ["apps:read"],
      pat_id: "pat-readonly",
    }
    const honoApp = buildTestApp(db, scopedUser)
    const res = await honoApp.request(`/apps/${appId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch: "develop" }),
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// DELETE /apps/:id
// ---------------------------------------------------------------------------

describe.skipIf(skip)("DELETE /apps/:id", () => {
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

  it("marks app deleting and enqueues an async delete job", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}`, { method: "DELETE" })

    expect(res.status).toBe(202)
    const body = (await res.json()) as {
      ok: boolean
      jobId: string
      status: string
    }
    expect(body.ok).toBe(true)
    expect(body.status).toBe("deleting")

    // Verify still in DB until the worker performs the cascade delete.
    const rows = await db.select().from(apps)
    const found = rows.find((r) => r.id === appId)
    expect(found).toBeDefined()
    expect(found!.status).toBe("deleting")

    const jobs = await db
      .select()
      .from(app_delete_jobs)
      .where(eq(app_delete_jobs.app_id, appId))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.app_id).toBe(appId)
    expect(jobs[0]!.status).toBe("pending")
  })

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db)
    const otherProject = await createTestProject(db, other.id)
    const { id: otherAppId } = await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${otherAppId}`, {
      method: "DELETE",
    })

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /apps/:id/rollback — with explicit buildId (W2.A)
// ---------------------------------------------------------------------------

async function createTestBuild(
  db: TestDb,
  appId: string,
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled",
  opts: { imageTag?: string; commitSha?: string; commitMessage?: string } = {}
) {
  const id = nanoid()
  const now = new Date()
  const startedAt = new Date(now.getTime() - 60_000)
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
  })
  return { id }
}

// ---------------------------------------------------------------------------
// GET /apps/:id/builds — commitMessage exposed in serializeBuild
// ---------------------------------------------------------------------------

describe.skipIf(skip)("GET /apps/:id/builds", () => {
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

  it("exposes commitMessage from build row", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    await createTestBuild(db, appId, "succeeded", {
      commitSha: "abc1234",
      commitMessage: "feat: add commit message field",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/builds`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      builds: { commitMessage: string | null }[]
    }
    expect(body.builds).toHaveLength(1)
    expect(body.builds[0]!.commitMessage).toBe("feat: add commit message field")
  })

  it("exposes commitMessage as null when absent", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    await createTestBuild(db, appId, "succeeded")

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/builds`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      builds: { commitMessage: string | null }[]
    }
    expect(body.builds[0]!.commitMessage).toBeNull()
  })
})

describe.skipIf(skip)("GET /apps/:id/runtime-logs", () => {
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

  it("returns recent runtime log lines from the resolved app container", async () => {
    const { id: appId } = await createTestApp(db, {
      userId,
      projectId,
      name: "Runtime App",
    })
    await db
      .update(apps)
      .set({
        container_id: "ploydok-app-runtime-app-blue",
        updated_at: new Date(),
      })
      .where(eq(apps.id, appId))

    using _agentSpy = spyOn(singletons, "getSharedAgent").mockReturnValue({
      listContainers: async () => ({
        containers: [
          {
            id: "ctr-runtime",
            name: "ploydok-app-runtime-app-blue",
            image: "127.0.0.1:5000/app-runtime:tag",
            status: "running",
            uptimeS: 120,
            cpuPct: 1.5,
            memBytes: 1024,
            memLimitBytes: 4096,
            restartCount: 0,
            kind: "app",
            appId,
            color: "blue",
            lastPingMs: 0,
            lastPingOk: false,
            lastSeenMs: Date.now(),
          },
        ],
      }),
      containerLogs: async function* () {
        yield {
          stream: "stdout",
          line: "hello runtime",
          timestamp: "2026-04-18T20:00:00.000Z",
        }
        yield {
          stream: "stderr",
          line: "warn runtime",
          timestamp: "2026-04-18T20:00:01.000Z",
        }
      },
    } as unknown as ReturnType<typeof singletons.getSharedAgent>)

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request(`/apps/${appId}/runtime-logs`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      containerFound: boolean
      lines: Array<{ t: number; line: string; stream?: string }>
    }
    expect(body.containerFound).toBe(true)
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0]).toEqual({
      t: Date.parse("2026-04-18T20:00:00.000Z"),
      line: "hello runtime",
      stream: "stdout",
    })
    expect(body.lines[1]?.stream).toBe("stderr")
  })
})

describe.skipIf(skip)("POST /apps/:id/rollback", () => {
  let db: TestDb
  let userId: string
  let projectId: string

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
        super(`DeployFailedError[${appId}]: ${reason}`)
        this.name = "DeployFailedError"
      }
    },
  }))

  beforeEach(async () => {
    db = await makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    projectId = project.id
  })

  it("rollback with explicit succeeded buildId → 200", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    const { id: buildId } = await createTestBuild(db, appId, "succeeded")

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it("rollback with explicit failed buildId → 400 INVALID_BUILD_STATUS", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    const { id: failedBuildId } = await createTestBuild(db, appId, "failed")

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId: failedBuildId }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("INVALID_BUILD_STATUS")
  })

  it("rollback without buildId (legacy) — calls runner and returns 200", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    // No body — legacy behaviour
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
    })

    // Runner mock succeeds — expect 200
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it("rollback with non-existent buildId → 404", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId: "does-not-exist" }),
    })

    expect(res.status).toBe(404)
  })

  it("rollback for another user's app → 404", async () => {
    const other = await createTestUser(db)
    const otherProject = await createTestProject(db, other.id)
    const { id: otherAppId } = await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${otherAppId}/rollback`, {
      method: "POST",
    })

    expect(res.status).toBe(404)
  })

  it("stop returns 202 while runtime cleanup continues in background", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/stop`, {
      method: "POST",
    })

    expect(res.status).toBe(202)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET /apps/:id/activity — historical timeline derived from builds
// ---------------------------------------------------------------------------

describe.skipIf(skip)("GET /apps/:id/activity", () => {
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

  it("returns build.started + build.succeeded for a successful build", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    await createTestBuild(db, appId, "succeeded", {
      commitSha: "abc1234",
      commitMessage: "feat: new feature",
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/activity`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      events: Array<{ type: string; data: { commitSha?: string } }>
    }
    const types = body.events.map((e) => e.type)
    expect(types).toContain("build.started")
    expect(types).toContain("build.succeeded")
    expect(body.events[0]!.data.commitSha).toBe("abc1234")
  })

  it("returns build.failed with error message when failed", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    const buildId = nanoid()
    const now = new Date()
    await db.insert(builds).values({
      id: buildId,
      app_id: appId,
      status: "failed",
      build_method: "docker",
      image_tag: null,
      container_id: null,
      commit_sha: null,
      commit_message: null,
      log_path: null,
      error_message: "exit code 1",
      started_at: new Date(now.getTime() - 10_000),
      finished_at: now,
      created_at: now,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/activity`)

    const body = (await res.json()) as {
      events: Array<{ type: string; data: { errorMessage?: string } }>
    }
    const failed = body.events.find((e) => e.type === "build.failed")
    expect(failed).toBeDefined()
    expect(failed!.data.errorMessage).toBe("exit code 1")
  })

  it("emits only build.started for a still-running build", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })
    const buildId = nanoid()
    const now = new Date()
    await db.insert(builds).values({
      id: buildId,
      app_id: appId,
      status: "running",
      build_method: "docker",
      image_tag: null,
      container_id: null,
      commit_sha: null,
      commit_message: null,
      log_path: null,
      error_message: null,
      started_at: new Date(now.getTime() - 5_000),
      finished_at: null,
      created_at: now,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/activity`)

    const body = (await res.json()) as {
      events: Array<{ type: string }>
    }
    expect(body.events).toHaveLength(1)
    expect(body.events[0]!.type).toBe("build.started")
  })

  it("returns 404 for an app belonging to another user", async () => {
    const other = await createTestUser(db)
    const otherProject = await createTestProject(db, other.id)
    const { id: otherAppId } = await createTestApp(db, {
      userId: other.id,
      projectId: otherProject.id,
    })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${otherAppId}/activity`)

    expect(res.status).toBe(404)
  })

  it("returns an empty list when there are no builds", async () => {
    const { id: appId } = await createTestApp(db, { userId, projectId })

    const honoApp = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await honoApp.request(`/apps/${appId}/activity`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { events: Array<unknown> }
    expect(body.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /apps — auto-inject suggestedEnvVars
// ---------------------------------------------------------------------------

describe.skipIf(skip)("POST /apps — auto-inject suggestedEnvVars", () => {
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

  it("Symfony repo: injects PHP root/fallback and composer allow-superuser", async () => {
    // Mock ghProvider.fileExists: symfony.lock + composer.json present, everything else absent
    using _spy = spyOn(
      githubModule.ghProvider,
      "fileExists"
    ).mockImplementation(
      async (_installId: string, _fullName: string, filePath: string) => {
        return filePath === "composer.json" || filePath === "symfony.lock"
      }
    )

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Symfony App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/symfony-repo",
        branch: "main",
        installationId: "123456",
        buildMethod: "nixpacks",
      }),
    })

    expect(res.status).toBe(201)
    const { app: created } = (await res.json()) as { app: { id: string } }

    const envVars = await db
      .select()
      .from(secrets)
      .where(eq(secrets.app_id, created.id))
    const keys = envVars.map((v) => v.key)
    expect(keys).toContain("NIXPACKS_PHP_ROOT_DIR")
    expect(keys).toContain("NIXPACKS_PHP_FALLBACK_PATH")
    expect(keys).toContain("NIXPACKS_INSTALL_CMD")

    const rootDir = envVars.find((v) => v.key === "NIXPACKS_PHP_ROOT_DIR")
    expect(rootDir?.phase).toBe("build")
    expect(await decryptSecret(rootDir!.value_ciphertext, rootDir!.nonce)).toBe(
      "/app/public"
    )
    const fallback = envVars.find((v) => v.key === "NIXPACKS_PHP_FALLBACK_PATH")
    expect(fallback?.phase).toBe("build")
    expect(
      await decryptSecret(fallback!.value_ciphertext, fallback!.nonce)
    ).toBe("/index.php")
    const installCmd = envVars.find((v) => v.key === "NIXPACKS_INSTALL_CMD")
    expect(installCmd?.phase).toBe("build")
    expect(
      await decryptSecret(installCmd!.value_ciphertext, installCmd!.nonce)
    ).toContain("COMPOSER_ALLOW_SUPERUSER=1 composer install --no-interaction")
    const appEnv = envVars.find((v) => v.key === "APP_ENV")
    expect(appEnv?.phase).toBe("runtime")
    expect(await decryptSecret(appEnv!.value_ciphertext, appEnv!.nonce)).toBe(
      "prod"
    )
  })

  it("Symfony repo with compose.yaml: still injects Nixpacks PHP vars when build method is explicit", async () => {
    using _spy = spyOn(
      githubModule.ghProvider,
      "fileExists"
    ).mockImplementation(
      async (_installId: string, _fullName: string, filePath: string) => {
        return (
          filePath === "composer.json" ||
          filePath === "symfony.lock" ||
          filePath === "compose.yaml"
        )
      }
    )

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Symfony App With Compose",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/symfony-compose-repo",
        branch: "main",
        installationId: "123456",
        buildMethod: "nixpacks",
      }),
    })

    expect(res.status).toBe(201)
    const { app: created } = (await res.json()) as { app: { id: string } }

    const envVars = await db
      .select()
      .from(secrets)
      .where(eq(secrets.app_id, created.id))
    const phpRoot = envVars.find((v) => v.key === "NIXPACKS_PHP_ROOT_DIR")
    const installCmd = envVars.find((v) => v.key === "NIXPACKS_INSTALL_CMD")
    const appEnv = envVars.find((v) => v.key === "APP_ENV")

    expect(phpRoot?.phase).toBe("build")
    expect(await decryptSecret(phpRoot!.value_ciphertext, phpRoot!.nonce)).toBe(
      "/app/public"
    )
    expect(installCmd?.phase).toBe("build")
    expect(appEnv?.phase).toBe("runtime")
  })

  it("Laravel repo: injects runtime-safe defaults including APP_KEY", async () => {
    using _spy = spyOn(
      githubModule.ghProvider,
      "fileExists"
    ).mockImplementation(
      async (_installId: string, _fullName: string, filePath: string) => {
        return filePath === "composer.json" || filePath === "artisan"
      }
    )

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Laravel App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/laravel-repo",
        branch: "main",
        installationId: "123456",
        buildMethod: "nixpacks",
      }),
    })

    expect(res.status).toBe(201)
    const { app: created } = (await res.json()) as { app: { id: string } }
    const envVars = await db
      .select()
      .from(secrets)
      .where(eq(secrets.app_id, created.id))
    const byKey = new Map(
      await Promise.all(
        envVars.map(
          async (v) =>
            [v.key, await decryptSecret(v.value_ciphertext, v.nonce)] as const
        )
      )
    )
    expect(byKey.get("SESSION_DRIVER")).toBe("file")
    expect(byKey.get("CACHE_STORE")).toBe("file")
    expect(byKey.get("APP_KEY")).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })

  it("no installationId: auto-inject skipped, 201 still returned", async () => {
    const fileExistsSpy = spyOn(githubModule.ghProvider, "fileExists")

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "No Install App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
        // installationId deliberately omitted
        buildMethod: "nixpacks",
      }),
    })

    expect(res.status).toBe(201)
    expect(fileExistsSpy).not.toHaveBeenCalled()
    fileExistsSpy.mockRestore()
  })

  it("buildMethod=dockerfile: auto-inject skipped", async () => {
    const fileExistsSpy = spyOn(githubModule.ghProvider, "fileExists")

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Dockerfile App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
        installationId: "123456",
        buildMethod: "dockerfile",
      }),
    })

    expect(res.status).toBe(201)
    expect(fileExistsSpy).not.toHaveBeenCalled()
    fileExistsSpy.mockRestore()
  })

  it("ghProvider.fileExists throws: auto-inject fails silently, 201 still returned", async () => {
    using _spy = spyOn(
      githubModule.ghProvider,
      "fileExists"
    ).mockImplementation(async () => {
      throw new Error("GitHub API unavailable")
    })

    const app = buildTestApp(db, fakeUser(userId, `u@t.com`))
    const res = await app.request("/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Flaky GitHub App",
        projectId,
        gitProvider: "github",
        repoFullName: "owner/repo",
        branch: "main",
        installationId: "123456",
        buildMethod: "nixpacks",
      }),
    })

    // Must not blow up — auto-inject is best-effort
    expect(res.status).toBe(201)
  })
})
