// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"

const discordSendMock = mock(() => Promise.resolve({ ok: true }))
const slackSendMock = mock(() => Promise.resolve({ ok: true }))
const lookupMock = mock(async (hostname: string) => {
  if (hostname === "discord.com") {
    return [{ address: "162.159.128.233", family: 4 }]
  }
  if (hostname === "hooks.slack.com") {
    return [{ address: "3.130.95.182", family: 4 }]
  }
  throw new Error(`unmocked hostname: ${hostname}`)
})

mock.module("node:dns/promises", () => ({
  lookup: lookupMock,
}))

mock.module("../github/app-credentials", () => ({
  encryptField: mock(async (plaintext: string) => ({
    enc: Buffer.from(`enc:${plaintext}`),
    nonce: Buffer.from("nonce0000000"),
  })),
  decryptField: mock(async (enc: Buffer, _nonce: Buffer) =>
    enc.toString().replace("enc:", "")
  ),
}))

mock.module("../notify/discord", () => ({
  discordAdapter: { send: discordSendMock },
}))
mock.module("../notify/slack", () => ({
  slackAdapter: { send: slackSendMock },
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

import { createNotificationsRouter } from "./notifications"

type TestChannel = {
  id: string
  owner_id: string
  project_id: string | null
  kind: "discord" | "slack"
  name: string
  config: { kind: "discord" | "slack"; webhook_url: string }
  events: string[]
  enabled: boolean
  last_error: string | null
  last_sent_at: Date | null
  created_at: Date
}

const existingChannel: TestChannel = {
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

function makeDb(channels: TestChannel[] = [existingChannel]): Db {
  const returning = mock(() => Promise.resolve(channels.map((c) => ({ id: c.id }))))
  const whereDelete = mock(() => ({ returning }))
  const deleteFn = mock(() => ({ where: whereDelete }))

  function makeWhereChain(results: unknown[]) {
    const chain = {
      limit: mock((_n: number) => Promise.resolve(results)),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(results).then(resolve),
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

function buildApp(db: Db, user: AuthUser): Hono {
  const app = new Hono()
  app.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", user)
    return next()
  })
  app.route("/notifications", createNotificationsRouter(db))
  return app
}

const fakeUser: AuthUser = {
  id: "user1",
  email: "user1@test.com",
  display_name: "Test User",
  session_id: "sess-test",
}

describe("notifications routes", () => {
  beforeEach(() => {
    discordSendMock.mockClear()
    slackSendMock.mockClear()
    lookupMock.mockClear()
  })

  it("creates a discord channel with an official https webhook URL", async () => {
    const app = buildApp(makeDb([]), fakeUser)

    const res = await app.request("/notifications/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Discord #deploys",
        config: {
          kind: "discord",
          webhook_url: "https://discord.com/api/webhooks/123/tok",
        },
        events: ["build.succeeded"],
        enabled: true,
      }),
    })

    expect(res.status).toBe(201)
  })

  it("rejects a localhost discord webhook URL", async () => {
    const app = buildApp(makeDb([]), fakeUser)

    const res = await app.request("/notifications/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Blocked",
        config: {
          kind: "discord",
          webhook_url: "https://localhost/api/webhooks/123/tok",
        },
        events: ["build.succeeded"],
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain("blocked")
  })

  it("rejects a slack webhook URL on a non-official host", async () => {
    const app = buildApp(makeDb([]), fakeUser)

    const res = await app.request("/notifications/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad Slack",
        config: {
          kind: "slack",
          webhook_url: "https://example.com/services/T000/B000/XXX",
        },
        events: ["build.succeeded"],
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain("not allowed")
  })

  it("rejects testing a stored channel with an unsafe webhook URL", async () => {
    const db = makeDb([
      {
        ...existingChannel,
        kind: "slack",
        config: {
          kind: "slack",
          webhook_url: "https://10.0.0.7/services/T000/B000/XXX",
        },
      },
    ])
    const app = buildApp(db, fakeUser)

    const res = await app.request("/notifications/channels/ch1/test", {
      method: "POST",
    })

    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain("not allowed")
    expect(slackSendMock).not.toHaveBeenCalled()
  })
})
