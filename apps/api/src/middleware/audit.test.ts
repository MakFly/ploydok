// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { Hono } from "hono"
import { auditMiddleware } from "./audit"
import type { Db } from "@ploydok/db"
import type { Agent } from "../agent"

describe("auditMiddleware", () => {
  it("inserts audit log with signature on 2xx response", async () => {
    const mockDb = {
      transaction: mock(async (fn) => {
        return fn({
          insert: mock(() => ({
            values: mock(() => ({
              returning: mock(async () => [
                {
                  id: 1,
                  created_at: new Date(),
                  user_id: "user-1",
                  action: "test.action",
                  target_type: "test",
                  target_id: "target-123",
                  metadata: "{}",
                  prev_hash: null,
                  hash: "test-hash",
                  signature: "sig-123",
                  key_id: "kid-1",
                },
              ]),
            })),
          })),
          update: mock(() => ({
            set: mock(() => ({
              where: mock(() => ({
                returning: mock(async () => []),
              })),
            })),
          })),
          select: mock(() => ({
            from: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(async () => [
                  { hash: "prev-hash" },
                ]),
              })),
            })),
          })),
        })
      }),
    } as unknown as Db

    const mockAgent = {
      signAuditEntry: mock(async () => ({
        signature: new Uint8Array([1, 2, 3]),
        keyId: "kid-1",
      })),
    } as unknown as Agent

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, mockAgent, {
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

  it("writes unsigned entry when agent fails", async () => {
    const mockDb = {
      transaction: mock(async (fn) => {
        return fn({
          insert: mock(() => ({
            values: mock(() => ({
              returning: mock(async () => [
                {
                  id: 1,
                  created_at: new Date(),
                  user_id: "user-1",
                  action: "test.action",
                  target_type: "test",
                  target_id: "target-123",
                  metadata: "{}",
                  prev_hash: null,
                  hash: "test-hash",
                  signature: null,
                  key_id: null,
                },
              ]),
            })),
          })),
          update: mock(() => ({
            set: mock(() => ({
              where: mock(() => ({
                returning: mock(async () => []),
              })),
            })),
          })),
          select: mock(() => ({
            from: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(async () => [
                  { hash: "prev-hash" },
                ]),
              })),
            })),
          })),
        })
      }),
    } as unknown as Db

    const mockAgent = {
      signAuditEntry: mock(async () => {
        throw new Error("agent unavailable")
      }),
    } as unknown as Agent

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, mockAgent, {
        action: "test.action",
        targetType: "test",
        extractTargetId: () => "target-123",
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
    const mockAgent = {} as Agent

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, mockAgent, {
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
    const mockDb = {
      transaction: mock(async (fn) => {
        return fn({
          insert: mock(() => ({
            values: mock(() => ({
              returning: mock(async () => [
                {
                  id: 1,
                  created_at: new Date(),
                  user_id: "user-1",
                  action: "test.action",
                  target_type: "test",
                  target_id: "target-123",
                  metadata: '{"key":"value"}',
                  prev_hash: null,
                  hash: "test-hash",
                  signature: "sig-123",
                  key_id: "kid-1",
                },
              ]),
            })),
          })),
          update: mock(() => ({
            set: mock(() => ({
              where: mock(() => ({
                returning: mock(async () => []),
              })),
            })),
          })),
          select: mock(() => ({
            from: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(async () => [
                  { hash: "prev-hash" },
                ]),
              })),
            })),
          })),
        })
      }),
    } as unknown as Db

    const mockAgent = {
      signAuditEntry: mock(async () => ({
        signature: new Uint8Array([1, 2, 3]),
        keyId: "kid-1",
      })),
    } as unknown as Agent

    const app = new Hono()

    app.use(
      "/test",
      auditMiddleware(mockDb, mockAgent, {
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
