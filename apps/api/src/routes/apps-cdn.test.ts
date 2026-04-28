// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import { createCdnRouter } from "./apps-cdn.js"

const fakeApp: Record<string, unknown> = {
  id: "app-1",
  project_id: "proj-1",
  name: "Test",
  slug: "test",
  status: "running",
  domain: null,
  container_id: "ploydok-app-1-blue",
  runtime_port: 3000,
  healthcheck_port: 3000,
  build_method: "nixpacks",
  static_spa_fallback: true,
  cdn_mode: "off",
  cdn_cache_ttl_s: 300,
  cdn_cache_paths: [],
  cdn_compression: false,
  cdn_image_optim: false,
  cdn_headers: null,
  cdn_external_provider: null,
}

const updateCalls: Array<Record<string, unknown>> = []

function makeDb(appOverride?: Partial<typeof fakeApp>): Db {
  const app = { ...fakeApp, ...appOverride }
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => Promise.resolve([{ app }]) }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updateCalls.push(patch)
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...app, ...patch }]),
          }),
        }
      },
    }),
  } as unknown as Db
}

function makeApp(db: Db): Hono {
  const app = new Hono()
  app.use("*", (c, next) => {
    ;(c as never as { set: (key: string, value: unknown) => void }).set(
      "user",
      {
        id: "user-1",
        email: "test@example.com",
        display_name: "Test",
        session_id: "s1",
      }
    )
    return next()
  })
  app.route("/apps", createCdnRouter(db))
  return app
}

beforeEach(() => {
  updateCalls.length = 0
  mock.restore()
})

describe("GET /apps/:id/cdn", () => {
  test("returns persisted CDN config", async () => {
    const app = makeApp(
      makeDb({
        cdn_mode: "internal",
        cdn_cache_paths: ["/assets/*"],
        cdn_compression: true,
        cdn_headers: '{"X-Frame-Options":"DENY"}',
      })
    )

    const res = await app.request("/apps/app-1/cdn")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      mode: "internal",
      cache_paths: ["/assets/*"],
      compression: true,
      headers: { "X-Frame-Options": "DENY" },
      ready: true,
    })
  })
})

describe("PUT /apps/:id/cdn", () => {
  test("validates external provider", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/cdn", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "external",
        cache_ttl_s: 300,
        cache_paths: [],
        compression: false,
        image_optim: false,
        headers: {},
        external_provider: null,
      }),
    })

    expect(res.status).toBe(400)
    expect(updateCalls).toHaveLength(0)
  })

  test("rejects unsupported external CDN providers", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/cdn", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "external",
        cache_ttl_s: 300,
        cache_paths: [],
        compression: false,
        image_optim: false,
        headers: {},
        external_provider: "bunny",
      }),
    })

    expect(res.status).toBe(400)
    expect(updateCalls).toHaveLength(0)
  })

  test("persists validated CDN config", async () => {
    const app = makeApp(makeDb())
    const res = await app.request("/apps/app-1/cdn", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "internal",
        cache_ttl_s: 600,
        cache_paths: ["/assets/*"],
        compression: true,
        image_optim: true,
        headers: { "Cache-Control": "public, max-age=600" },
        external_provider: null,
      }),
    })

    expect(res.status).toBe(200)
    expect(updateCalls[0]).toMatchObject({
      cdn_mode: "internal",
      cdn_cache_ttl_s: 600,
      cdn_cache_paths: ["/assets/*"],
      cdn_compression: true,
      cdn_image_optim: true,
      cdn_headers: '{"Cache-Control":"public, max-age=600"}',
      cdn_external_provider: null,
    })
  })
})
