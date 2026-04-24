// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { Hono } from "hono"
import { createDatabasesRouter } from "./databases"
import type { Db } from "@ploydok/db"

// ── Mocks ─────────────────────────────────────────────────────────────────────

mock.module("../auth/second-factor", () => ({
  requireTotpVerified: mock(
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next()
    }
  ),
}))

mock.module("../databases/spawner", () => ({
  spawnDatabase: mock(async () => ({
    id: "db-test-id",
    containerId: "container-123",
    connectionString:
      "postgres://ploydok:secret@ploydok-db-db-test-id:5432/app",
  })),
  getConnectionString: mock(
    async () => "postgres://ploydok:secret@ploydok-db-db-test-id:5432/app"
  ),
  startDatabaseContainer: mock(async () => {}),
  stopDatabaseContainer: mock(async () => {}),
  recreateDatabaseContainer: mock(
    async (_db: unknown, row: Record<string, unknown>) => row
  ),
  removeDatabasePublicProxy: mock(async () => {}),
}))

mock.module("../debug/singletons", () => ({
  getSharedAgent: () => ({
    containerStop: mock(async () => ({})),
    containerRemove: mock(async () => ({})),
    containerLogs: mock(async function* () {}),
    containerStats: mock(async function* () {}),
  }),
  getSharedCaddy: () => ({}),
}))

mock.module("../logger", () => ({
  childLogger: mock(() => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  })),
}))

mock.module("../env", () => ({
  env: {
    DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "test",
    WEB_ORIGIN: "http://localhost:5173",
    SESSION_SECRET: "test-secret",
    MASTER_KEY: "dGVzdC1tYXN0ZXIta2V5LTMyLWJ5dGVzLXBhZGRpbmc=",
    REDIS_URL: "redis://127.0.0.1:6379/0",
    PLOYDOK_REGISTRY_URL: "127.0.0.1:5000",
    PLOYDOK_REGISTRY_PUSH_URL: "registry:5000",
    PLOYDOK_BUILD_DIR: "/tmp/.ploydok-test/builds",
    PLOYDOK_BUILDKIT_ADDR: "docker-container://ploydok-buildkitd",
    GITHUB_APP_CALLBACK_URL: "http://localhost:3335/github/app/callback",
    GITLAB_OAUTH_CALLBACK_URL: "http://localhost:3335/gitlab/callback",
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

const fakeUser = {
  id: "user-1",
  email: "t@t.com",
  display_name: "T",
  session_id: "s",
}

function makeChain(result: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => ({ limit: () => Promise.resolve(result) }),
    limit: () => Promise.resolve(result),
  }
  return chain
}

function buildDb(
  overrides: Partial<{
    selectResult: unknown[]
    dbRow: unknown
  }> = {}
) {
  const { dbRow = null } = overrides

  const db: Record<string, unknown> = {
    select: mock(() => makeChain(dbRow ? [{ db: dbRow }] : [])),
    insert: mock(() => ({ values: mock(async () => {}) })),
    update: mock(() => ({
      set: mock(() => ({ where: mock(async () => {}) })),
    })),
    delete: mock(() => ({ where: mock(async () => {}) })),
  }
  return db as unknown as Db
}

function wrapRouter(db: Db) {
  const app = new Hono()
  app.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", fakeUser)
    await next()
  })
  app.route("/", createDatabasesRouter(db))
  return app
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /databases validation", () => {
  it("returns 400 on invalid kind", async () => {
    const db = buildDb({ dbRow: { id: "proj-1" } })
    const app = wrapRouter(db)
    const res = await app.fetch(
      req("POST", "/", {
        projectId: "proj-1",
        kind: "sqlite",
        name: "mydb",
        plan: "small",
      })
    )
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe("VALIDATION_ERROR")
  })

  it("returns 400 on invalid name (uppercase)", async () => {
    const db = buildDb({ dbRow: { id: "proj-1" } })
    const app = wrapRouter(db)
    const res = await app.fetch(
      req("POST", "/", {
        projectId: "proj-1",
        kind: "postgres",
        name: "MyDB",
        plan: "small",
      })
    )
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe("VALIDATION_ERROR")
  })

  it("returns 400 on invalid plan", async () => {
    const db = buildDb({ dbRow: { id: "proj-1" } })
    const app = wrapRouter(db)
    const res = await app.fetch(
      req("POST", "/", {
        projectId: "proj-1",
        kind: "postgres",
        name: "mydb",
        plan: "xlarge",
      })
    )
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe("VALIDATION_ERROR")
  })
})

describe("DELETE /databases/:id", () => {
  const mockDatabaseRow = {
    id: "db-test-id",
    project_id: "proj-1",
    kind: "postgres",
    name: "mydb",
    plan: "small",
    status: "running",
    host: "ploydok-db-db-test-id",
    port: 5432,
    container_id: "container-123",
    connection_string_enc: Buffer.from("enc"),
    connection_string_nonce: Buffer.from("nonce"),
  }

  it("returns 400 if confirm string is wrong", async () => {
    const db = buildDb({ dbRow: mockDatabaseRow })
    const app = wrapRouter(db)
    const res = await app.fetch(
      req("DELETE", "/db-test-id", { confirm: "wrong" })
    )
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe("CONFIRM_REQUIRED")
  })

  it("returns 404 if database not found", async () => {
    const db = buildDb({ dbRow: null })
    const app = wrapRouter(db)
    const res = await app.fetch(
      req("DELETE", "/nonexistent", { confirm: "delete nonexistent" })
    )
    expect(res.status).toBe(404)
  })
})

describe("GET /databases", () => {
  it("returns 200 with array", async () => {
    const db: Record<string, unknown> = {
      select: mock(() => {
        const chain: Record<string, unknown> = {
          from: () => chain,
          innerJoin: () => chain,
          where: () => Promise.resolve([]),
          then: (onFulfilled: (v: unknown[]) => unknown) =>
            Promise.resolve([]).then(onFulfilled),
        }
        return chain
      }),
      insert: mock(() => ({ values: mock(async () => {}) })),
      update: mock(() => ({
        set: mock(() => ({ where: mock(async () => {}) })),
      })),
      delete: mock(() => ({ where: mock(async () => {}) })),
    }
    const app = wrapRouter(db as unknown as Db)
    const res = await app.fetch(req("GET", "/"))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })
})

describe("POST /databases/:id lifecycle", () => {
  const mockDatabaseRow = {
    id: "db-test-id",
    project_id: "proj-1",
    kind: "postgres",
    version: "16",
    name: "mydb",
    plan: "small",
    status: "running",
    health_status: "healthy",
    host: "ploydok-db-db-test-id",
    port: 5432,
    exposure_mode: "internal",
    public_enabled: false,
    public_port: null,
    public_host: null,
    public_url: null,
    volume_name: "ploydok-db-db-test-id",
    container_id: "container-123",
    connection_string_enc: Buffer.from("enc"),
    connection_string_nonce: Buffer.from("nonce"),
  }

  it("starts a database", async () => {
    const db = buildDb({ dbRow: mockDatabaseRow })
    const app = wrapRouter(db)
    const res = await app.fetch(req("POST", "/db-test-id/start"))
    expect(res.status).toBe(200)
  })

  it("updates network settings", async () => {
    const db = buildDb({ dbRow: mockDatabaseRow })
    const app = wrapRouter(db)
    const res = await app.fetch(
      req("PATCH", "/db-test-id/network", {
        exposureMode: "public_proxy",
        publicEnabled: true,
      })
    )
    expect(res.status).toBe(200)
  })
})
