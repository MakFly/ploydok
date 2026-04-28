// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"

mock.module("@ploydok/db/queries", () => ({
  getAppForUser: mock(async () => ({
    id: "app-1",
    project_id: "proj-1",
    name: "demo-app",
  })),
  getMembership: mock(async () => null),
  listEventWebhooks: mock(async () => []),
  getEventWebhook: mock(async () => null),
  createEventWebhook: mock(async () => null),
  updateEventWebhook: mock(async () => null),
  deleteEventWebhook: mock(async () => false),
}))

mock.module("../auth/second-factor", () => ({
  requireTotpVerified:
    () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

mock.module("../logger", () => ({
  childLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

const { createBackupsRouter } = await import("./backups")

const fakeUser = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  session_id: "sess-1",
}

function makeChain(results: unknown[]) {
  const result = results.shift() ?? []
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(result),
    then: (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled),
  }
  return chain
}

function buildDb(selectResults: unknown[]) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const deletes: unknown[] = []

  const db: Record<string, unknown> = {
    select: mock(() => makeChain(selectResults)),
    insert: mock((table: unknown) => ({
      values: mock(async (values: unknown) => {
        inserts.push({ table, values })
      }),
    })),
    update: mock((table: unknown) => ({
      set: mock((values: unknown) => ({
        where: mock(async () => {
          updates.push({ table, values })
        }),
      })),
    })),
    delete: mock((table: unknown) => ({
      where: mock(async () => {
        deletes.push(table)
      }),
    })),
  }

  return { db: db as unknown as Db, inserts, updates, deletes }
}

function wrapRouter(
  db: Db,
  user: typeof fakeUser & { token_scopes?: string[] } = fakeUser
) {
  const app = new Hono()
  app.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", user)
    await next()
  })
  app.route("/", createBackupsRouter(db))
  return app
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe("volume backup routes", () => {
  it("lists app volume backups for an authorized member", async () => {
    const volumeRow = {
      id: "vol-1",
      app_id: "app-1",
      name: "data",
      mount_path: "/data",
      size_limit_bytes: null,
      created_at: new Date("2026-04-28T09:00:00.000Z"),
    }
    const backupRow = {
      id: "bkp-1",
      app_id: "app-1",
      volume_id: "vol-1",
      config_id: "cfg-1",
      destination_kind: "local",
      location: "/tmp/backup.tar",
      size_bytes: 42,
      age_encrypted: false,
      status: "succeeded",
      error: null,
      started_at: new Date("2026-04-28T10:00:00.000Z"),
      finished_at: new Date("2026-04-28T10:01:00.000Z"),
    }
    const { db } = buildDb([[volumeRow], [backupRow]])

    const res = await wrapRouter(db).fetch(
      req("GET", "/apps/app-1/volumes/vol-1/backups")
    )

    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      backups: Array<{
        id: string
        appId: string
        volumeId: string
        configId: string
        destinationKind: string
        location: string
        sizeBytes: number
        ageEncrypted: boolean
        status: string
        error: string | null
        startedAt: string
        finishedAt: string
      }>
    }
    expect(data.backups).toEqual([
      {
        id: "bkp-1",
        appId: "app-1",
        volumeId: "vol-1",
        configId: "cfg-1",
        destinationKind: "local",
        location: "/tmp/backup.tar",
        sizeBytes: 42,
        ageEncrypted: false,
        status: "succeeded",
        error: null,
        startedAt: "2026-04-28T10:00:00.000Z",
        finishedAt: "2026-04-28T10:01:00.000Z",
      },
    ])
  })

  it("creates a volume backup config with the same shape as database backups", async () => {
    const volumeRow = {
      id: "vol-1",
      app_id: "app-1",
      name: "data",
      mount_path: "/data",
      size_limit_bytes: null,
      created_at: new Date("2026-04-28T09:00:00.000Z"),
    }
    const createdRow = {
      id: "cfg-created",
      app_id: "app-1",
      volume_id: "vol-1",
      destination_kind: "local",
      s3_endpoint: null,
      s3_bucket: null,
      s3_prefix: null,
      s3_region: null,
      s3_credentials_secret_id: null,
      schedule_cron: "0 3 * * *",
      retention_days: 14,
      age_recipient_public_key: null,
      enabled: true,
      last_run_at: null,
      last_error: null,
      created_at: new Date("2026-04-28T10:00:00.000Z"),
    }
    const { db, inserts } = buildDb([[volumeRow], [], [createdRow]])

    const res = await wrapRouter(db).fetch(
      req("PUT", "/apps/app-1/volumes/vol-1/backup-config", {
        retentionDays: 14,
      })
    )

    expect(res.status).toBe(201)
    expect(inserts).toHaveLength(1)
    const payload = inserts[0] as {
      values: { app_id: string; volume_id: string; retention_days: number }
    }
    expect(payload.values.app_id).toBe("app-1")
    expect(payload.values.volume_id).toBe("vol-1")
    expect(payload.values.retention_days).toBe(14)

    const data = (await res.json()) as {
      config: { appId: string; volumeId: string; retentionDays: number }
    }
    expect(data.config.appId).toBe("app-1")
    expect(data.config.volumeId).toBe("vol-1")
    expect(data.config.retentionDays).toBe(14)
  })

  it("requires apps:write scope to mutate backup configuration with a PAT", async () => {
    const { db, inserts } = buildDb([])

    const res = await wrapRouter(db, {
      ...fakeUser,
      token_scopes: ["apps:read"],
    }).fetch(
      req("PUT", "/apps/app-1/volumes/vol-1/backup-config", {
        retentionDays: 14,
      })
    )

    expect(res.status).toBe(403)
    expect(inserts).toHaveLength(0)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })
})

describe("database backup routes", () => {
  it("requires database scopes for database backup config reads", async () => {
    const { db } = buildDb([])

    const res = await wrapRouter(db, {
      ...fakeUser,
      token_scopes: ["apps:read"],
    }).fetch(req("GET", "/databases/db-1/backup-config"))

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("allows databases:* scope for database backup config reads", async () => {
    const dbRow = { id: "db-1", name: "primary" }
    const configRow = {
      id: "cfg-1",
      database_id: "db-1",
      destination_kind: "local",
      s3_endpoint: null,
      s3_bucket: null,
      s3_prefix: null,
      s3_region: null,
      s3_credentials_secret_id: null,
      schedule_cron: "0 3 * * *",
      retention_days: 7,
      age_recipient_public_key: null,
      enabled: true,
      last_run_at: null,
      last_error: null,
      created_at: new Date("2026-04-28T10:00:00.000Z"),
    }
    const { db } = buildDb([[{ db: dbRow }], [configRow]])

    const res = await wrapRouter(db, {
      ...fakeUser,
      token_scopes: ["databases:*"],
    }).fetch(req("GET", "/databases/db-1/backup-config"))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { config: { id: string } }
    expect(body.config.id).toBe("cfg-1")
  })
})
