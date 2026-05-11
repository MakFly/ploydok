// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"

type WebhookCreatePayload = {
  id?: string
  org_id?: string
  name?: string
  url?: string
  events?: string[]
}

type WebhookUpdatePayload = {
  name?: string
  url?: string
  events?: string[]
  enabled?: boolean
}

let ownerAllowed = true

const getMembershipMock = mock(async () => ({
  org_id: "org-1",
  user_id: "user-1",
  role: "owner",
}))
const isOrgOwnerMock = mock(async () => ownerAllowed)
const createEventWebhookMock = mock(async (_db: Db, payload: WebhookCreatePayload) => ({
  ...payload,
  last_triggered_at: null,
  last_response_status: null,
  last_error: null,
}))
const updateEventWebhookMock = mock(
  async (_db: Db, _id: string, _orgId: string, updates: WebhookUpdatePayload) => ({
    id: "wh-1",
    org_id: "org-1",
    name: updates.name ?? "Webhook",
    url: updates.url ?? "https://1.1.1.1/hook",
    events: updates.events ?? ["deploy.succeeded"],
    enabled: updates.enabled ?? true,
    secret_enc: null,
    secret_nonce: null,
    last_triggered_at: null,
    last_response_status: null,
    last_error: null,
    created_at: new Date("2025-01-01T00:00:00.000Z"),
  })
)
const deleteEventWebhookMock = mock(async () => true)
const getEventWebhookMock = mock(async () => ({
  id: "wh-1",
  org_id: "org-1",
  name: "Webhook",
  url: "https://1.1.1.1/hook",
  events: ["deploy.succeeded"],
  enabled: true,
  secret_enc: null,
  secret_nonce: null,
  last_triggered_at: null,
  last_response_status: null,
  last_error: null,
  created_at: new Date("2025-01-01T00:00:00.000Z"),
}))

mock.module("@ploydok/db/queries", () => ({
  getAppForUser: mock(async () => null),
  getMembership: getMembershipMock,
  isOrgOwner: isOrgOwnerMock,
  listEventWebhooks: mock(async () => []),
  getEventWebhook: getEventWebhookMock,
  listEnabledWebhooksForEvent: mock(async () => []),
  createEventWebhook: createEventWebhookMock,
  updateEventWebhook: updateEventWebhookMock,
  deleteEventWebhook: deleteEventWebhookMock,
}))

mock.module("@ploydok/db", () => ({
  projects: {
    id: "id",
    slug: "slug",
  },
}))

mock.module("../github/app-credentials", () => ({
  encryptField: mock(async (plaintext: string) => ({
    enc: Buffer.from(`enc:${plaintext}`),
    nonce: Buffer.from("nonce"),
  })),
  decryptField: mock(async () => "secret"),
}))

const { createEventWebhooksRouter } = await import("./event-webhooks")

function buildDb(): Db {
  const db = {
    select: () => {
      const chain = {
        from() {
          return chain
        },
        where() {
          return chain
        },
        limit: async () => [{ id: "org-1" }],
      }
      return chain
    },
  }
  return db as unknown as Db
}

function buildApp(user: AuthUser) {
  const app = new Hono<{ Variables: { user: AuthUser } }>()
  app.use("*", async (c, next) => {
    c.set("user", user)
    return next()
  })
  app.route("/orgs", createEventWebhooksRouter(buildDb()))
  return app
}

const sessionUser: AuthUser = {
  id: "user-1",
  email: "user-1@test.com",
  display_name: "User One",
  session_id: "sess-1",
}

describe("event-webhooks routes", () => {
  beforeEach(() => {
    ownerAllowed = true
    getMembershipMock.mockClear()
    isOrgOwnerMock.mockClear()
    createEventWebhookMock.mockClear()
    updateEventWebhookMock.mockClear()
    deleteEventWebhookMock.mockClear()
    getEventWebhookMock.mockClear()
  })

  it("rejects localhost/private webhook destinations on create", async () => {
    const app = buildApp(sessionUser)
    const res = await app.request("/orgs/org-1/event-webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Blocked",
        url: "http://127.0.0.1:8080/hook",
        events: ["deploy.succeeded"],
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(createEventWebhookMock).not.toHaveBeenCalled()
  })

  it("accepts a public https webhook destination", async () => {
    const app = buildApp(sessionUser)
    const res = await app.request("/orgs/org-1/event-webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Public",
        url: "https://1.1.1.1/hook",
        events: ["deploy.succeeded"],
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { url: string }
    expect(body.url).toBe("https://1.1.1.1/hook")
    expect(createEventWebhookMock).toHaveBeenCalled()
  })

  it("rejects non-owner POST/PATCH/DELETE mutations", async () => {
    ownerAllowed = false
    const app = buildApp(sessionUser)

    const createRes = await app.request("/orgs/org-1/event-webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Blocked",
        url: "https://1.1.1.1/hook",
        events: ["deploy.succeeded"],
      }),
    })
    const patchRes = await app.request("/orgs/org-1/event-webhooks/wh-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Blocked" }),
    })
    const deleteRes = await app.request("/orgs/org-1/event-webhooks/wh-1", {
      method: "DELETE",
    })

    for (const res of [createRes, patchRes, deleteRes]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        error: {
          code: "FORBIDDEN",
          message: "Only owners can manage event webhooks",
        },
      })
    }
    expect(createEventWebhookMock).not.toHaveBeenCalled()
    expect(updateEventWebhookMock).not.toHaveBeenCalled()
    expect(deleteEventWebhookMock).not.toHaveBeenCalled()
  })

  it("rejects testing a stored webhook that points to a private address", async () => {
    getEventWebhookMock.mockImplementationOnce(async () => ({
      id: "wh-1",
      org_id: "org-1",
      name: "Blocked Test",
      url: "https://10.0.0.5/hook",
      events: ["deploy.succeeded"],
      enabled: true,
      secret_enc: null,
      secret_nonce: null,
      last_triggered_at: null,
      last_response_status: null,
      last_error: null,
      created_at: new Date("2025-01-01T00:00:00.000Z"),
    }))

    const app = buildApp(sessionUser)
    const res = await app.request("/orgs/org-1/event-webhooks/wh-1/test", {
      method: "POST",
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("rejects webhook test redirects before following them", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(null, { status: 302 })) as never

    try {
      const app = buildApp(sessionUser)
      const res = await app.request("/orgs/org-1/event-webhooks/wh-1/test", {
        method: "POST",
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe("VALIDATION_ERROR")
      expect(body.error.message).toBe("Webhook redirects are not allowed")
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://1.1.1.1/hook",
        expect.objectContaining({
          headers: expect.any(Headers),
          redirect: "manual",
        })
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
