// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { createHmac } from "node:crypto"
import { Hono } from "hono"
import type { Context, Next } from "hono"
import { env } from "../env"

let mockGitLabConfig: Record<string, unknown> | null = null
let fakeInstanceAdmin = true
const deliveryInserts: Array<{
  row: Record<string, unknown>
  rawBodyBuffer?: Buffer
}> = []

const fakeTable = new Proxy(
  {},
  {
    get: (_target, prop) => Symbol(String(prop)),
  }
)

const fakeDb = {
  select: mock(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ is_instance_admin: fakeInstanceAdmin }],
      }),
    }),
  })),
  insert: mock(() => ({
    values: mock(() => ({
      onConflictDoUpdate: mock(async () => undefined),
    })),
  })),
}

mock.module("@ploydok/db", () => ({
  createDb: () => fakeDb,
  provider_credentials: fakeTable,
  users: {
    id: "id",
    is_instance_admin: "is_instance_admin",
  },
}))

mock.module("@ploydok/db/queries", () => ({
  deleteGitLabConfig: async () => undefined,
  deleteGitLabTokens: async () => undefined,
  getCacheStatus: async () => null,
  getGitLabConfig: async () => mockGitLabConfig,
  getGitLabTokens: async () => null,
  getInstallationStaleness: async () => null,
  listInstallations: async () => [],
  listRepos: async () => [],
  saveGitLabConfig: async () => undefined,
  upsertGitLabTokens: async () => undefined,
}))

mock.module("../github/app-credentials", () => ({
  encryptField: async (value: string) => ({
    enc: Buffer.from(`enc:${value}`),
    nonce: Buffer.from("nonce"),
  }),
  decryptField: async (enc: Buffer) => enc.toString().replace(/^enc:/, ""),
}))

mock.module("../gitlab/webhook", () => ({
  handleGitLabWebhook: mock(async () => undefined),
  verifyGitLabToken: (receivedHeader: string | null, expectedSecret: string) =>
    receivedHeader === expectedSecret,
}))

mock.module("../webhooks/deliveries", () => ({
  findRecentByPayloadHash: async () => null,
  insertDelivery: async (
    _db: unknown,
    row: Record<string, unknown>,
    rawBodyBuffer?: Buffer
  ) => {
    const insert: {
      row: Record<string, unknown>
      rawBodyBuffer?: Buffer
    } = { row }
    if (rawBodyBuffer !== undefined) {
      insert.rawBodyBuffer = rawBodyBuffer
    }
    deliveryInserts.push(insert)
    return "delivery-id"
  },
}))

mock.module("../webhooks/rate-limiters", () => ({
  gitlabWebhookRateLimit: async (_c: Context, next: Next) => next(),
}))

mock.module("../worker/handlers/sync-provider-repos", () => ({
  enqueueProviderReposSync: async () => undefined,
}))

mock.module("../logger", () => ({
  childLogger: () => ({
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  }),
}))

const { gitlabRouter } = await import("./gitlab")

const FAKE_USER = {
  id: "user-test-1",
  email: "test@example.com",
  display_name: "Test User",
  session_id: "session-test-1",
}

function buildApp(user?: typeof FAKE_USER): Hono {
  const app = new Hono()
  app.use("*", async (c, next) => {
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", user)
    }
    return next()
  })
  app.route("/gitlab", gitlabRouter)
  return app
}

beforeEach(() => {
  mockGitLabConfig = null
  fakeInstanceAdmin = true
  deliveryInserts.length = 0
})

describe("GitLab configuration mutations", () => {
  it("allows an instance admin to save the global configuration", async () => {
    const app = buildApp(FAKE_USER)
    const res = await app.request("/gitlab/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "client",
        client_secret: "secret",
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("rejects a non-admin POST /gitlab/config", async () => {
    fakeInstanceAdmin = false
    const app = buildApp(FAKE_USER)
    const res = await app.request("/gitlab/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "client",
        client_secret: "secret",
      }),
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "admin_required" })
  })

  it("rejects a non-admin DELETE /gitlab/config", async () => {
    fakeInstanceAdmin = false
    const app = buildApp(FAKE_USER)
    const res = await app.request("/gitlab/config", { method: "DELETE" })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "admin_required" })
  })
})

describe("POST /gitlab/webhook", () => {
  it("does not insert a delivery for an invalid token", async () => {
    mockGitLabConfig = {
      webhook_secret_enc: Buffer.from("enc:webhook-secret"),
      webhook_secret_nonce: Buffer.from("nonce"),
    }
    const app = buildApp()
    const res = await app.request("/gitlab/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gitlab-Token": "wrong-secret",
        "X-Gitlab-Event": "Push Hook",
        "X-Gitlab-Event-UUID": "delivery-poison",
      },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "invalid_token" })
    expect(deliveryInserts).toHaveLength(0)
  })
})

describe("GET /gitlab/config", () => {
  it("exposes the callback URL even when nothing is configured", async () => {
    mockGitLabConfig = null
    const app = buildApp(FAKE_USER)
    const res = await app.request("/gitlab/config")

    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      configured: boolean
      callback_url: string
    }
    expect(data.configured).toBe(false)
    expect(data.callback_url).toBe(env.GITLAB_OAUTH_CALLBACK_URL)
  })

  it("exposes the callback URL once configured", async () => {
    mockGitLabConfig = {
      instance_url: "https://gitlab.com",
      client_id: "abc",
    }
    const app = buildApp(FAKE_USER)
    const res = await app.request("/gitlab/config")

    const data = (await res.json()) as {
      configured: boolean
      callback_url: string
    }
    expect(data.configured).toBe(true)
    expect(data.callback_url).toBe(env.GITLAB_OAUTH_CALLBACK_URL)
  })
})

describe("GitLab OAuth round-trip", () => {
  const realFetch = globalThis.fetch

  function configured() {
    mockGitLabConfig = {
      instance_url: "https://gitlab.com",
      client_id: "abc",
      client_secret_enc: Buffer.from("enc:secret"),
      client_secret_nonce: Buffer.from("nonce"),
    }
  }

  function readStateCookie(res: Response): string {
    const setCookie = res.headers.get("set-cookie") ?? ""
    const match = /gl_oauth_state=([^;]+)/.exec(setCookie)
    return decodeURIComponent(match![1]!)
  }

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function stubTokenExchange() {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch
  }

  it("carries an allow-listed return target from connect to callback", async () => {
    configured()
    stubTokenExchange()
    const app = buildApp(FAKE_USER)

    const start = await app.request("/gitlab/connect?return_to=%2Fonboarding")
    expect(start.status).toBe(302)
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state"
    )!
    const cookie = readStateCookie(start)

    const back = await app.request(`/gitlab/callback?code=xyz&state=${state}`, {
      headers: { cookie: `gl_oauth_state=${encodeURIComponent(cookie)}` },
    })

    expect(back.status).toBe(302)
    expect(back.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/onboarding?connected=1`
    )
  })

  it("falls back to settings when no return target was requested", async () => {
    configured()
    stubTokenExchange()
    const app = buildApp(FAKE_USER)

    const start = await app.request("/gitlab/connect")
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state"
    )!
    const cookie = readStateCookie(start)

    const back = await app.request(`/gitlab/callback?code=xyz&state=${state}`, {
      headers: { cookie: `gl_oauth_state=${encodeURIComponent(cookie)}` },
    })

    expect(back.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/settings/git-providers/gitlab?connected=1`
    )
  })

  it("ignores a return target outside the allow-list", async () => {
    configured()
    stubTokenExchange()
    const app = buildApp(FAKE_USER)

    const start = await app.request(
      "/gitlab/connect?return_to=https%3A%2F%2Fevil.com"
    )
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state"
    )!
    const cookie = readStateCookie(start)

    const back = await app.request(`/gitlab/callback?code=xyz&state=${state}`, {
      headers: { cookie: `gl_oauth_state=${encodeURIComponent(cookie)}` },
    })

    expect(back.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/settings/git-providers/gitlab?connected=1`
    )
  })

  it("keeps accepting a legacy bare-state cookie", async () => {
    configured()
    stubTokenExchange()
    const app = buildApp(FAKE_USER)
    const state = "legacy-gitlab-state"
    const mac = createHmac("sha256", env.SESSION_SECRET)
      .update(state)
      .digest("hex")

    const back = await app.request(`/gitlab/callback?code=xyz&state=${state}`, {
      headers: {
        cookie: `gl_oauth_state=${encodeURIComponent(`${state}.${mac}`)}`,
      },
    })

    expect(back.status).toBe(302)
    expect(back.headers.get("location")).toBe(
      `${env.WEB_ORIGIN}/settings/git-providers/gitlab?connected=1`
    )
  })

  it("rejects a state that does not match the cookie", async () => {
    configured()
    const app = buildApp(FAKE_USER)

    const start = await app.request("/gitlab/connect?return_to=%2Fonboarding")
    const cookie = readStateCookie(start)

    const back = await app.request("/gitlab/callback?code=xyz&state=bad", {
      headers: { cookie: `gl_oauth_state=${encodeURIComponent(cookie)}` },
    })

    expect(back.status).toBe(400)
    const data = (await back.json()) as { error: string }
    expect(data.error).toBe("invalid_state")
  })
})
