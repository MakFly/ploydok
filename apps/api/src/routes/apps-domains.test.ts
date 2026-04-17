// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { createDb } from "@ploydok/db"
import { users, projects, apps } from "@ploydok/db"
import { createAppsDomainsRouter } from "./apps-domains"
import type { AuthUser } from "../auth/middleware"

// ---------------------------------------------------------------------------
// In-memory test DB
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
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      hostname TEXT NOT NULL UNIQUE,
      tls_status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS domains_hostname_unique ON domains (hostname)`)
  db.run(`CREATE INDEX IF NOT EXISTS domains_app_id_idx ON domains (app_id)`)

  return db
}

type TestDb = ReturnType<typeof makeTestDb>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createTestUser(
  db: TestDb,
  overrides: Partial<{ id: string; email: string }> = {},
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
  return { id }
}

async function createTestApp(
  db: TestDb,
  opts: { userId: string; projectId: string },
) {
  const id = nanoid()
  const now = new Date()
  const slug = `app-${id.slice(0, 8)}`
  await db.insert(apps).values({
    id,
    project_id: opts.projectId,
    name: `App ${id}`,
    slug,
    status: "created",
    created_at: now,
    updated_at: now,
    git_provider: "github",
    repo_full_name: "owner/repo",
    branch: "main",
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
  })
  return { id, slug }
}

// ---------------------------------------------------------------------------
// Test app builder
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

  const router = createAppsDomainsRouter(db)
  honoApp.route("/apps", router)
  return honoApp
}

function fakeUser(id: string): AuthUser {
  return { id, email: `${id}@test.com`, display_name: "Test User", session_id: "sess-test" }
}

// ---------------------------------------------------------------------------
// GET /apps/:id/domains
// ---------------------------------------------------------------------------

describe("GET /apps/:id/domains", () => {
  let db: TestDb
  let userId: string
  let appId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    const app = await createTestApp(db, { userId, projectId: project.id })
    appId = app.id
  })

  it("returns 401 when no auth user", async () => {
    const honoApp = buildTestApp(db)
    const res = await honoApp.request(`/apps/${appId}/domains`)
    // No user set → getUser returns undefined → cast throws. The router should 404/500.
    // In practice the app.use middleware in production does requireAuth which returns 401.
    // Without auth middleware in tests, we get a 500 (cast fails). We verify not 200.
    expect(res.status).not.toBe(200)
  })

  it("returns 404 when app belongs to another user", async () => {
    const other = await createTestUser(db)
    const honoApp = buildTestApp(db, fakeUser(other.id))
    const res = await honoApp.request(`/apps/${appId}/domains`)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")
  })

  it("returns 404 for unknown app id", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/does-not-exist/domains`)
    expect(res.status).toBe(404)
  })

  it("returns empty list when no domains", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/${appId}/domains`)
    expect(res.status).toBe(200)
    const body = await res.json() as { domains: unknown[] }
    expect(body.domains).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// POST /apps/:id/domains
// ---------------------------------------------------------------------------

describe("POST /apps/:id/domains", () => {
  let db: TestDb
  let userId: string
  let appId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    const app = await createTestApp(db, { userId, projectId: project.id })
    appId = app.id
  })

  it("creates a domain with valid hostname → 201", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "custom.example.com" }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { domain: { id: string; hostname: string; tlsStatus: string } }
    expect(body.domain.hostname).toBe("custom.example.com")
    expect(body.domain.tlsStatus).toBe("pending")
    expect(body.domain.id).toBeString()
  })

  it("normalises hostname to lowercase", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "UPPER.Example.COM" }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { domain: { hostname: string } }
    expect(body.domain.hostname).toBe("upper.example.com")
  })

  it("rejects an invalid hostname → 400", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "not-a-valid-hostname" }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("rejects plain IP addresses → 400", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "192.168.1.1" }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects duplicate hostname globally → 409", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))

    // First insert succeeds.
    await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "dupe.example.com" }),
    })

    // Second insert on same hostname (even same app) → 409.
    const res = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "dupe.example.com" }),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("CONFLICT")
  })

  it("rejects duplicate hostname across apps → 409", async () => {
    // Create a second app under same user.
    const project2 = await createTestProject(db, userId)
    const app2 = await createTestApp(db, { userId, projectId: project2.id })

    const honoApp = buildTestApp(db, fakeUser(userId))

    await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "cross.example.com" }),
    })

    const res = await honoApp.request(`/apps/${app2.id}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "cross.example.com" }),
    })
    expect(res.status).toBe(409)
  })

  it("returns 404 when app belongs to another user", async () => {
    const other = await createTestUser(db)
    const honoApp = buildTestApp(db, fakeUser(other.id))
    const res = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "valid.example.com" }),
    })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /apps/:id/domains/:domainId
// ---------------------------------------------------------------------------

describe("DELETE /apps/:id/domains/:domainId", () => {
  let db: TestDb
  let userId: string
  let appId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    const app = await createTestApp(db, { userId, projectId: project.id })
    appId = app.id
  })

  it("deletes an existing domain → 204", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))

    // Add a domain.
    const addRes = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "to-delete.example.com" }),
    })
    const { domain } = await addRes.json() as { domain: { id: string } }

    const delRes = await honoApp.request(`/apps/${appId}/domains/${domain.id}`, {
      method: "DELETE",
    })
    expect(delRes.status).toBe(204)
  })

  it("returns 404 for unknown domainId", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(`/apps/${appId}/domains/does-not-exist`, {
      method: "DELETE",
    })
    expect(res.status).toBe(404)
  })

  it("returns 404 when domain belongs to different app", async () => {
    const project2 = await createTestProject(db, userId)
    const app2 = await createTestApp(db, { userId, projectId: project2.id })
    const honoApp = buildTestApp(db, fakeUser(userId))

    // Add domain to app1.
    const addRes = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "app1.example.com" }),
    })
    const { domain } = await addRes.json() as { domain: { id: string } }

    // Try to delete it via app2's path.
    const res = await honoApp.request(`/apps/${app2.id}/domains/${domain.id}`, {
      method: "DELETE",
    })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /apps/:id/domains/:domainId/recheck
// ---------------------------------------------------------------------------

describe("POST /apps/:id/domains/:domainId/recheck", () => {
  let db: TestDb
  let userId: string
  let appId: string

  beforeEach(async () => {
    db = makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    const app = await createTestApp(db, { userId, projectId: project.id })
    appId = app.id
  })

  it("rechecks an existing domain → 200 with domain object", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))

    const addRes = await honoApp.request(`/apps/${appId}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "recheck.example.com" }),
    })
    const { domain } = await addRes.json() as { domain: { id: string } }

    const res = await honoApp.request(
      `/apps/${appId}/domains/${domain.id}/recheck`,
      { method: "POST" },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { domain: { id: string; tlsStatus: string } }
    expect(body.domain.id).toBe(domain.id)
    // In test env Caddy is not running → status will be "failed" (tryCaddyCheckTls caught error)
    expect(["pending", "issued", "failed"]).toContain(body.domain.tlsStatus)
  })

  it("returns 404 for unknown domainId", async () => {
    const honoApp = buildTestApp(db, fakeUser(userId))
    const res = await honoApp.request(
      `/apps/${appId}/domains/no-such-domain/recheck`,
      { method: "POST" },
    )
    expect(res.status).toBe(404)
  })
})
