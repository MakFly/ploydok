// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock, beforeEach } from "bun:test"
import { Hono } from "hono"
import type { Context, Next } from "hono"

let mockGitLabConfig: Record<string, unknown> | null = null
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
  insert: mock(() => ({
    values: mock(() => ({
      onConflictDoUpdate: mock(async () => undefined),
    })),
  })),
}

mock.module("@ploydok/db", () => ({
  createDb: () => fakeDb,
  provider_credentials: fakeTable,
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

function buildApp(): Hono {
  const app = new Hono()
  app.route("/gitlab", gitlabRouter)
  return app
}

beforeEach(() => {
  mockGitLabConfig = null
  deliveryInserts.length = 0
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
