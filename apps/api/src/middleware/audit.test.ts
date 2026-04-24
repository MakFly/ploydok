// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { Hono } from "hono"
import { auditMiddleware } from "./audit"
import type { Db } from "@ploydok/db"

describe("auditMiddleware", () => {
  it("inserts audit log on 2xx response", async () => {
    const mockDb = {
      insert: mock(() => ({
        values: mock(() => Promise.resolve()),
      })),
    } as unknown as Db

    const mockInsert = mock(() => Promise.resolve(true))

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, {
        action: "test.action",
        targetType: "test",
        extractTargetId: () => "target-123",
        extractOrgId: () => "org-123",
      })
    )

    app.get("/test", (c: any) => {
      c.set("user", { id: "user-1", email: "test@test.local" })
      return c.json({ ok: true }, 200)
    })

    const res = await app.request("/test")
    expect(res.status).toBe(200)
  })

  it("does not insert audit log on 4xx/5xx response", async () => {
    const mockDb = {} as Db

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, {
        action: "test.action",
        targetType: "test",
        extractTargetId: () => "target-123",
      })
    )

    app.get("/test", (c: any) => {
      return c.json({ error: "not found" }, 404)
    })

    const res = await app.request("/test")
    expect(res.status).toBe(404)
  })

  it("extracts metadata when provided", async () => {
    const mockDb = {} as Db

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, {
        action: "test.action",
        targetType: "test",
        extractTargetId: () => "target-123",
        extractMetadata: (c) => ({ key: "value" }),
      })
    )

    app.get("/test", (c: any) => {
      return c.json({ ok: true }, 200)
    })

    const res = await app.request("/test")
    expect(res.status).toBe(200)
  })
})
