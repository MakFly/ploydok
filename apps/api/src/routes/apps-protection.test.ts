// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"

mock.module("../caddy/client", () => ({
  CaddyClient: class {
    async getUpstream() {
      return { host: "app", port: 3000 }
    }

    async upsertRoute() {}
  },
}))

const { createAppsProtectionRouter } = await import("./apps-protection.js")

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const fakeApp: Record<string, unknown> = {
  id: "app-1",
  project_id: "proj-1",
  name: "Test",
  slug: "test",
  status: "running",
  protection_basic_auth_enabled: false,
  protection_basic_auth_user_enc: null,
  protection_basic_auth_user_nonce: null,
  protection_basic_auth_pass_enc: null,
  protection_basic_auth_pass_nonce: null,
  protection_ip_allowlist: null,
  protection_rate_limit_rps: null,
  caddy_extra_handlers: null,
  // required fields
  domain: "app.example.com",
  container_id: "c1",
  healthcheck_port: 3000,
}

function makeDb(appOverride?: Partial<typeof fakeApp>): Db {
  const app = { ...fakeApp, ...appOverride }
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => Promise.resolve([{ app }]) }),
          }),
          where: () => ({ limit: () => Promise.resolve([{ app }]) }),
        }),
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([app]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  } as unknown as Db
}

function makeApp(db: Db): Hono {
  const app = new Hono()
  // Inject fake auth user
  app.use("*", (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", {
      id: "user-1",
      email: "test@example.com",
      display_name: "Test",
      session_id: "s1",
    })
    return next()
  })
  const router = createAppsProtectionRouter(db)
  app.route("/apps", router)
  return app
}

describe("GET /apps/:id/protection", () => {
  test("returns default protection config", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/protection")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.basicAuth).toMatchObject({ enabled: false, user: null })
    expect(body.ipAllowlist).toEqual([])
    expect(body.rateLimitRps).toBeNull()
  })

  test("returns 404 when app not found", async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({ limit: () => Promise.resolve([]) }),
            }),
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
    } as unknown as Db
    const app = makeApp(db)
    const res = await app.request("/apps/not-found/protection")
    expect(res.status).toBe(404)
  })
})

describe("PATCH /apps/:id/protection", () => {
  test("returns 400 on invalid CIDR", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/protection", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ipAllowlist: ["not-a-cidr!!"] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect((body.error as Record<string, unknown>).code).toBe(
      "VALIDATION_ERROR"
    )
  })

  test("accepts valid CIDR list", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/protection", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ipAllowlist: ["10.0.0.0/8", "192.168.1.0/24"] }),
    })
    expect(res.status).toBe(200)
  })
})

describe("GET /apps/:id/caddy-extra", () => {
  test("returns null handlers when none configured", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/caddy-extra")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.handlers).toBeNull()
  })

  test("returns parsed handlers from JSON", async () => {
    const handlers = [
      { handler: "headers", response: { headers: { "X-Custom": ["test"] } } },
    ]
    const app = makeApp(
      makeDb({ caddy_extra_handlers: JSON.stringify(handlers) })
    )
    const res = await app.request("/apps/app-1/caddy-extra")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.handlers).toEqual(handlers)
  })

  test("returns 404 when app not found", async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({ limit: () => Promise.resolve([]) }),
            }),
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
    } as unknown as Db
    const app = makeApp(db)
    const res = await app.request("/apps/not-found/caddy-extra")
    expect(res.status).toBe(404)
  })
})

describe("PATCH /apps/:id/caddy-extra", () => {
  test("returns 400 on invalid handler enum", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/caddy-extra", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handlers: [{ handler: "exec" }] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect((body.error as Record<string, unknown>).code).toBe(
      "VALIDATION_ERROR"
    )
  })

  test("accepts valid handlers with passthrough fields", async () => {
    const app = makeApp(makeDb())
    const handlers = [
      { handler: "headers", response: { headers: { "X-Custom": ["test"] } } },
    ]
    const res = await app.request("/apps/app-1/caddy-extra", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handlers }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.handlers).toEqual(handlers)
  })

  test("accepts null handlers to clear", async () => {
    const app = makeApp(
      makeDb({ caddy_extra_handlers: JSON.stringify([{ handler: "vars" }]) })
    )
    const res = await app.request("/apps/app-1/caddy-extra", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handlers: null }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.handlers).toBeNull()
  })

  test("returns 404 when app not found", async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({ limit: () => Promise.resolve([]) }),
            }),
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
    } as unknown as Db
    const app = makeApp(db)
    const res = await app.request("/apps/not-found/caddy-extra", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handlers: [] }),
    })
    expect(res.status).toBe(404)
  })
})
