// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { users, projects, apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { makeTestDb as makePgTestDb, TEST_PG_URL } from "../test/db-helpers"
import { createAppsEnvRouter } from "./apps-env"
import type { AuthUser } from "../auth/middleware"

const skip = !TEST_PG_URL
if (skip) console.log("[apps-env.test] PLOYDOK_TEST_PG_URL not set — skipping")

async function makeTestDb() {
  const { db } = await makePgTestDb()
  return db
}

type TestDb = Db

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

async function createTestUser(db: TestDb, overrides: Partial<{ id: string; email: string }> = {}) {
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

async function createTestApp(db: TestDb, userId: string, projectId: string) {
  const id = nanoid()
  const now = new Date()
  await db.insert(apps).values({
    id,
    project_id: projectId,
    name: `App ${id}`,
    slug: `app-${id}`,
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
    restart_policy: "unless-stopped",
    domain: `app-${id}.demo.ploydok.local`,
    build_method: "auto",
    healthcheck_path: "/",
    healthcheck_port: null,
    healthcheck_interval_s: 5,
    healthcheck_timeout_s: 3,
    healthcheck_retries: 6,
    healthcheck_start_period_s: 0,
  })
  return { id }
}

function fakeUser(id: string, email = "user@test.com"): AuthUser {
  return { id, email, display_name: "Test User", session_id: "sess-test" }
}

function buildTestApp(db: TestDb, authedUser?: AuthUser): Hono {
  const honoApp = new Hono()

  honoApp.use("*", async (c, next) => {
    if (authedUser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", authedUser)
    }
    return next()
  })

  const router = createAppsEnvRouter(db)
  honoApp.route("/apps", router)
  return honoApp
}

// ---------------------------------------------------------------------------
// GET /:id/env
// ---------------------------------------------------------------------------

describe.skipIf(skip)("GET /apps/:id/env", () => {
  let db: TestDb
  let userId: string
  let appId: string

  beforeEach(async () => {
    db = await makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    appId = (await createTestApp(db, userId, project.id)).id
  })

  it("returns 404 when not authenticated (no user set)", async () => {
    // No authed user → the apps router's getUser() will get undefined
    // which will cause a runtime error → 500 in this test context,
    // but in production requireAuth middleware returns 401 before reaching routes.
    // We simulate the unauthed path by using a non-existent userId.
    const app = buildTestApp(db, fakeUser("non-existent-user"))
    const res = await app.request(`/apps/${appId}/env`)
    expect(res.status).toBe(404)
  })

  it("returns 404 when app belongs to another user", async () => {
    const otherUser = await createTestUser(db)
    const app = buildTestApp(db, fakeUser(otherUser.id))
    const res = await app.request(`/apps/${appId}/env`)
    expect(res.status).toBe(404)
  })

  it("returns empty vars for a new app", async () => {
    const app = buildTestApp(db, fakeUser(userId))
    const res = await app.request(`/apps/${appId}/env`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { vars: unknown[] }
    expect(body.vars).toEqual([])
  })

  it("returns vars with secrets masked", async () => {
    // First PATCH to seed some vars.
    const app = buildTestApp(db, fakeUser(userId))
    await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [
          { key: "DATABASE_URL", value: "postgres://localhost/db", secret: false },
          { key: "API_SECRET", value: "super-secret", secret: true },
        ],
      }),
    })

    const res = await app.request(`/apps/${appId}/env`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      vars: Array<{ key: string; value: string; secret: boolean }>
    }

    const dbVar = body.vars.find((v) => v.key === "DATABASE_URL")
    const secretVar = body.vars.find((v) => v.key === "API_SECRET")

    expect(dbVar?.value).toBe("postgres://localhost/db")
    expect(dbVar?.secret).toBe(false)

    // Secret value must be masked in GET response.
    expect(secretVar?.value).toBe("********")
    expect(secretVar?.secret).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PATCH /:id/env
// ---------------------------------------------------------------------------

describe.skipIf(skip)("PATCH /apps/:id/env", () => {
  let db: TestDb
  let userId: string
  let appId: string

  beforeEach(async () => {
    db = await makeTestDb()
    const user = await createTestUser(db)
    userId = user.id
    const project = await createTestProject(db, userId)
    appId = (await createTestApp(db, userId, project.id)).id
  })

  it("returns 404 when app belongs to another user", async () => {
    const otherUser = await createTestUser(db)
    const app = buildTestApp(db, fakeUser(otherUser.id))
    const res = await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vars: [{ key: "FOO", value: "bar" }] }),
    })
    expect(res.status).toBe(404)
  })

  it("returns 400 for invalid key format (lowercase)", async () => {
    const app = buildTestApp(db, fakeUser(userId))
    const res = await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vars: [{ key: "invalid_key", value: "v" }] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("returns 400 for duplicate keys in the same request", async () => {
    const app = buildTestApp(db, fakeUser(userId))
    const res = await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [
          { key: "FOO", value: "1" },
          { key: "FOO", value: "2" },
        ],
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("happy path: sets vars and returns masked response", async () => {
    const app = buildTestApp(db, fakeUser(userId))
    const res = await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [
          { key: "PORT", value: "3000", secret: false },
          { key: "TOKEN", value: "abc123", secret: true },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      vars: Array<{ key: string; value: string; secret: boolean }>
    }

    const portVar = body.vars.find((v) => v.key === "PORT")
    const tokenVar = body.vars.find((v) => v.key === "TOKEN")

    expect(portVar?.value).toBe("3000")
    expect(portVar?.secret).toBe(false)
    expect(tokenVar?.value).toBe("********")
    expect(tokenVar?.secret).toBe(true)
  })

  it("replaces existing vars (delete-then-insert semantics)", async () => {
    const app = buildTestApp(db, fakeUser(userId))

    // Seed.
    await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vars: [{ key: "OLD_VAR", value: "old" }] }),
    })

    // Replace with completely different set.
    const res = await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vars: [{ key: "NEW_VAR", value: "new" }] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { vars: Array<{ key: string }> }
    const keys = body.vars.map((v) => v.key)

    expect(keys).not.toContain("OLD_VAR")
    expect(keys).toContain("NEW_VAR")
  })

  it("accepts empty vars array (clears all)", async () => {
    const app = buildTestApp(db, fakeUser(userId))

    // Seed.
    await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vars: [{ key: "FOO", value: "bar" }] }),
    })

    // Clear.
    const res = await app.request(`/apps/${appId}/env`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vars: [] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { vars: unknown[] }
    expect(body.vars).toEqual([])
  })
})
