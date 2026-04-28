// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import { requireInstanceAdmin } from "./instance-admin"

const fakeUser = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  session_id: "sess-1",
}

function makeDb(rows: Array<{ is_instance_admin: boolean }>) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(async () => rows),
        })),
      })),
    })),
  } as unknown as Db
}

describe("requireInstanceAdmin", () => {
  it("rejects authenticated users that are not instance admins", async () => {
    const app = new Hono()
    app.use("*", async (c, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", fakeUser)
      await next()
    })
    app.get("/admin", requireInstanceAdmin(makeDb([{ is_instance_admin: false }])), (c) =>
      c.json({ ok: true })
    )

    const res = await app.request("/admin")

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "admin_required" })
  })

  it("allows instance admins", async () => {
    const app = new Hono()
    app.use("*", async (c, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", fakeUser)
      await next()
    })
    app.get("/admin", requireInstanceAdmin(makeDb([{ is_instance_admin: true }])), (c) =>
      c.json({ ok: true })
    )

    const res = await app.request("/admin")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
