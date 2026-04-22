// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test, mock, beforeEach } from "bun:test"
import { Hono } from "hono"
import { createAppsProtectionRouter } from "./apps-protection.js"
import type { Db } from "@ploydok/db"

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const fakeApp = {
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
    ;(c as any).set("user", { id: "user-1", email: "test@example.com", display_name: "Test", session_id: "s1" })
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
    const body = await res.json() as Record<string, unknown>
    expect(body.basicAuth).toMatchObject({ enabled: false, user: null })
    expect(body.ipAllowlist).toEqual([])
    expect(body.rateLimitRps).toBeNull()
  })

  test("returns 404 when app not found", async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
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
    const body = await res.json() as Record<string, unknown>
    expect((body.error as Record<string,unknown>).code).toBe("VALIDATION_ERROR")
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
