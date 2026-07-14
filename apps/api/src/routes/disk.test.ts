// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import { Hono } from "hono"
import type { AuthUser } from "../auth/middleware"
import type { Db } from "@ploydok/db"

// ---------------------------------------------------------------------------
// Fake db — only `select().from().where().limit()` is exercised, by
// requireInstanceAdmin's `users.is_instance_admin` lookup.
// ---------------------------------------------------------------------------

let fakeInstanceAdmin = true
let fakeJob: Record<string, unknown> | null = null

const fakeDb = {
  select: mock((selection?: Record<string, unknown>) => ({
    from: () => ({
      where: () => ({
        limit: async () =>
          selection?.is_instance_admin
            ? [{ is_instance_admin: fakeInstanceAdmin }]
            : fakeJob
              ? [fakeJob]
              : [],
      }),
    }),
  })),
} as unknown as Db

// ---------------------------------------------------------------------------
// Mock agent — imageDf + hostStats
// ---------------------------------------------------------------------------

const mockImageDf = mock(() =>
  Promise.resolve({
    categories: [
      { kind: "images", totalBytes: 1000, reclaimableBytes: 200, count: 5 },
      {
        kind: "build_cache",
        totalBytes: 500,
        reclaimableBytes: 500,
        count: 1,
      },
    ],
    layersSizeBytes: 900,
  })
)

const mockHostStats = mock(() =>
  Promise.resolve({
    cpuPercent: 1,
    memTotalBytes: 0,
    memUsedBytes: 0,
    memAvailableBytes: 0,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
    load1: 0,
    load5: 0,
    load15: 0,
    diskTotalBytes: 10_000,
    diskUsedBytes: 4_000,
    diskFreeBytes: 6_000,
    inodesTotal: 0,
    inodesUsed: 0,
    cpuCount: 1,
    uptimeSeconds: 0,
    error: "",
  })
)

// NOTE: this file uses a dynamic `await import("./disk")` below (needed so the
// mock is registered before the route module resolves its agent singleton),
// which fully replaces the process-wide "../debug/singletons" module for the
// rest of the bun:test run. `getSharedCaddy` is stubbed too so sibling test
// files that transitively import it (e.g. via worker/index.ts →
// jobs/caddy-reconcile.ts) don't crash with a missing-export SyntaxError.
mock.module("../debug/singletons", () => ({
  getSharedAgent: () => ({
    imageDf: mockImageDf,
    hostStats: mockHostStats,
  }),
  getSharedCaddy: () => ({}),
}))

const { createDiskRouter } = await import("./disk")

// ---------------------------------------------------------------------------
// Test app builder — injects a fake auth middleware
// ---------------------------------------------------------------------------

function fakeUser(id = "user-1"): AuthUser {
  return {
    id,
    email: "test@example.com",
    display_name: "Test User",
    session_id: "sess-test",
  }
}

function buildTestApp(authedUser?: AuthUser): Hono {
  const app = new Hono()

  app.use("*", async (c, next) => {
    if (authedUser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", authedUser)
    }
    return next()
  })

  app.route("/disk", createDiskRouter(fakeDb))
  return app
}

beforeEach(() => {
  fakeInstanceAdmin = true
  fakeJob = null
  mockImageDf.mockClear()
  mockHostStats.mockClear()
})

describe("GET /disk/jobs/:jobId", () => {
  it("returns the persisted terminal result", async () => {
    fakeJob = {
      id: "job-1",
      kind: "gc.images",
      status: "succeeded",
      result: { imagesDeleted: 2, spaceReclaimedBytes: 4096 },
      error_message: null,
      queued_at: new Date("2026-07-14T10:00:00.000Z"),
      claimed_at: new Date("2026-07-14T10:00:01.000Z"),
      finished_at: new Date("2026-07-14T10:00:02.000Z"),
    }
    const app = buildTestApp(fakeUser())
    const res = await app.request("/disk/jobs/job-1")

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      jobId: "job-1",
      kind: "gc.images",
      status: "succeeded",
      result: { imagesDeleted: 2, spaceReclaimedBytes: 4096 },
    })
  })

  it("returns 404 for a missing reclaim job", async () => {
    const app = buildTestApp(fakeUser())
    const res = await app.request("/disk/jobs/missing")
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /disk/usage
// ---------------------------------------------------------------------------

describe("GET /disk/usage", () => {
  it("returns 401 without an authenticated user", async () => {
    const app = buildTestApp()
    const res = await app.request("/disk/usage")
    expect(res.status).toBe(401)
  })

  it("returns 403 for a non instance-admin user", async () => {
    fakeInstanceAdmin = false
    const app = buildTestApp(fakeUser())
    const res = await app.request("/disk/usage")
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("admin_required")
  })

  it("maps the agent's ImageDf + HostStats responses into the shared DiskUsageResponse shape", async () => {
    const app = buildTestApp(fakeUser())
    const res = await app.request("/disk/usage")
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      categories: Array<{
        kind: string
        totalBytes: number
        reclaimableBytes: number
        count: number
      }>
      layersSizeBytes: number
      host: { totalBytes: number; usedBytes: number; freeBytes: number } | null
    }

    expect(body.categories).toEqual([
      { kind: "images", totalBytes: 1000, reclaimableBytes: 200, count: 5 },
      {
        kind: "build_cache",
        totalBytes: 500,
        reclaimableBytes: 500,
        count: 1,
      },
    ])
    expect(body.layersSizeBytes).toBe(900)
    expect(body.host).toEqual({
      totalBytes: 10_000,
      usedBytes: 4_000,
      freeBytes: 6_000,
    })
    expect(mockImageDf).toHaveBeenCalledTimes(1)
    expect(mockHostStats).toHaveBeenCalledTimes(1)
  })

  it("returns host: null when hostStats fails (imageDf still succeeds)", async () => {
    mockHostStats.mockImplementationOnce(() =>
      Promise.reject(new Error("agent unavailable"))
    )
    const app = buildTestApp(fakeUser())
    const res = await app.request("/disk/usage")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { host: unknown }
    expect(body.host).toBeNull()
  })

  it("returns 502 when imageDf fails", async () => {
    mockImageDf.mockImplementationOnce(() =>
      Promise.reject(new Error("agent unavailable"))
    )
    const app = buildTestApp(fakeUser())
    const res = await app.request("/disk/usage")
    expect(res.status).toBe(502)
  })
})
