// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { Hono } from "hono"
import { createNotificationsRouter } from "./notifications"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"

// ── Module mocks — before import ─────────────────────────────────────────────

mock.module("../github/app-credentials", () => ({
  encryptField: mock(async (plaintext: string) => ({
    enc: Buffer.from(`enc:${plaintext}`),
    nonce: Buffer.from("nonce0000000"),
  })),
  decryptField: mock(async (enc: Buffer, _nonce: Buffer) => enc.toString().replace("enc:", "")),
}))

mock.module("../notify/discord", () => ({
  discordAdapter: { send: mock(() => Promise.resolve({ ok: true })) },
}))
mock.module("../notify/slack", () => ({
  slackAdapter: { send: mock(() => Promise.resolve({ ok: true })) },
}))
mock.module("../notify/telegram", () => ({
  telegramAdapter: { send: mock(() => Promise.resolve({ ok: false, reason: "coming_soon" })) },
}))
mock.module("../notify/whatsapp", () => ({
  whatsappAdapter: { send: mock(() => Promise.resolve({ ok: false, reason: "coming_soon" })) },
}))
mock.module("../notify/email", () => ({
  emailAdapter: { send: mock(() => Promise.resolve({ ok: true })) },
}))

// ── DB mock factory ───────────────────────────────────────────────────────────

const existingChannel = {
  id: "ch1",
  owner_id: "user1",
  project_id: null,
  kind: "discord" as const,
  name: "Discord #deploys",
  config: { kind: "discord", webhook_url: "https://discord.com/api/webhooks/test/tok" },
  events: ["build.succeeded"],
  enabled: true,
  last_error: null,
  last_sent_at: null,
  created_at: new Date("2025-01-01"),
}

function makeDb(channels: typeof existingChannel[] = [existingChannel]): Db {
  const returning = mock(() => Promise.resolve(channels.map((c) => ({ id: c.id }))))
  const whereDelete = mock(() => ({ returning }))
  const deleteFn = mock(() => ({ where: whereDelete }))

  // Chainable select builder: select().from().where().limit()
  function makeWhereChain(results: unknown[]) {
    const chain = {
      limit: mock((_n: number) => Promise.resolve(results)),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(results).then(resolve),
    }
    return chain
  }

  const fromFn = mock(() => ({
    where: mock(() => makeWhereChain(channels)),
  }))
  const selectFn = mock(() => ({ from: fromFn }))
  const updateWhere = mock(() => Promise.resolve([]))
  const updateSet = mock(() => ({ where: updateWhere }))
  const updateFn = mock(() => ({ set: updateSet }))
  const insertValues = mock(() => Promise.resolve([]))
  const insertFn = mock(() => ({ values: insertValues }))

  return {
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    delete: deleteFn,
  } as unknown as Db
}

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp(db: Db, user: AuthUser): Hono {
  const app = new Hono()
  app.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", user)
    return next()
  })
  const router = createNotificationsRouter(db)
  app.route("/notifications", router)
  return app
}

const fakeUser: AuthUser = {
  id: "user1",
  email: "user1@test.com",
  display_name: "Test User",
  session_id: "sess-test",
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /notifications/channels", () => {
  it("returns channels list with 200", async () => {
    const db = makeDb()
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels")
    expect(res.status).toBe(200)
    const json = await res.json() as { channels: unknown[] }
    expect(Array.isArray(json.channels)).toBe(true)
  })
})

describe("POST /notifications/channels", () => {
  it("creates a discord channel and returns 201", async () => {
    const db = makeDb([])
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Discord #deploys",
        config: { kind: "discord", webhook_url: "https://discord.com/api/webhooks/123/tok" },
        events: ["build.succeeded"],
        enabled: true,
      }),
    })

    expect(res.status).toBe(201)
    const json = await res.json() as { id: string }
    expect(typeof json.id).toBe("string")
  })

  it("rejects invalid body with 400", async () => {
    const db = makeDb([])
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad", config: { kind: "discord" } }), // missing webhook_url + events
    })

    expect(res.status).toBe(400)
  })
})

describe("PATCH /notifications/channels/:id", () => {
  it("updates enabled flag and returns 200", async () => {
    const db = makeDb()
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels/ch1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })

    expect(res.status).toBe(200)
  })
})

describe("DELETE /notifications/channels/:id", () => {
  it("returns 200 on existing channel", async () => {
    const db = makeDb()
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels/ch1", {
      method: "DELETE",
    })

    expect(res.status).toBe(200)
  })
})

describe("POST /notifications/channels/:id/test — canary", () => {
  it("returns ok=true for discord adapter", async () => {
    const db = makeDb()
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels/ch1/test", {
      method: "POST",
    })

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean }
    expect(json.ok).toBe(true)
  })
})
