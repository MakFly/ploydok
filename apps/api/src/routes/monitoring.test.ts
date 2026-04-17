// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { Hono } from "hono"
import { monitoringRouter, monitoringTick } from "./monitoring"
import { eventBus } from "../worker/event-bus"
import type { AuthUser } from "../auth/middleware"
import type { ContainerStatus } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Mock agent
// ---------------------------------------------------------------------------

const mockListContainers = mock(() =>
  Promise.resolve({
    containers: [
      {
        id: "ctr-1",
        name: "ploydok-web",
        image: "nginx:alpine",
        status: "running",
        uptimeS: 120,
        cpuPct: 5.5,
        memBytes: 104857600,
        memLimitBytes: 536870912,
        restartCount: 0,
        kind: "app",
        appId: "app-123",
        color: "blue",
        lastPingMs: 0,
        lastPingOk: false,
        lastSeenMs: 0,
      },
      {
        id: "ctr-2",
        name: "ploydok-caddy",
        image: "caddy:2",
        status: "running",
        uptimeS: 300,
        cpuPct: 1.2,
        memBytes: 52428800,
        memLimitBytes: 268435456,
        restartCount: 0,
        kind: "infra",
        appId: "",
        color: "",
        lastPingMs: 0,
        lastPingOk: false,
        lastSeenMs: 0,
      },
    ],
  }),
)

const mockPingContainer = mock(() =>
  Promise.resolve({
    ok: true,
    statusCode: 200,
    latencyMs: 42,
    error: "",
  }),
)

mock.module("../debug/singletons", () => ({
  getSharedAgent: () => ({
    listContainers: mockListContainers,
    pingContainer: mockPingContainer,
  }),
}))

// ---------------------------------------------------------------------------
// Test app builder — injects fake auth middleware
// ---------------------------------------------------------------------------

function buildTestApp(authedUser?: AuthUser): Hono {
  const app = new Hono()

  app.use("*", async (c, next) => {
    if (authedUser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(c as any).set("user", authedUser)
    }
    return next()
  })

  app.route("/monitoring", monitoringRouter)
  return app
}

function fakeUser(id = "user-1"): AuthUser {
  return { id, email: "test@example.com", display_name: "Test User", session_id: "sess-test" }
}

// ---------------------------------------------------------------------------
// GET /monitoring/overview
// ---------------------------------------------------------------------------

describe("GET /monitoring/overview", () => {
  it("returns 401 without authenticated user", async () => {
    const app = buildTestApp() // no user
    const res = await app.request("/monitoring/overview")
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHENTICATED")
  })

  it("returns MonitoringOverview with containers when authenticated", async () => {
    const app = buildTestApp(fakeUser())
    const res = await app.request("/monitoring/overview")
    expect(res.status).toBe(200)

    const body = await res.json() as {
      containers: Array<{ id: string; status: string; kind?: string }>
      generated_at: number
    }

    expect(body.containers).toBeArray()
    expect(body.containers.length).toBe(2)
    expect(body.generated_at).toBeNumber()

    const web = body.containers.find((c) => c.id === "ctr-1")
    expect(web).toBeDefined()
    expect(web!.status).toBe("running")
    expect(web!.kind).toBe("app")
  })
})

// ---------------------------------------------------------------------------
// POST /monitoring/ping/:id
// ---------------------------------------------------------------------------

describe("POST /monitoring/ping/:id", () => {
  it("returns ping response with valid body when authenticated", async () => {
    const app = buildTestApp(fakeUser())
    const res = await app.request("/monitoring/ping/ctr-2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/health", port: 80 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; statusCode: number; latencyMs: number; error: string }
    expect(body.ok).toBe(true)
    expect(body.statusCode).toBe(200)
    expect(body.latencyMs).toBe(42)
  })

  it("returns 400 when port is missing from body", async () => {
    const app = buildTestApp(fakeUser())
    const res = await app.request("/monitoring/ping/ctr-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/health" }), // missing port
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("returns 401 without authenticated user", async () => {
    const app = buildTestApp()
    const res = await app.request("/monitoring/ping/ctr-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/health", port: 80 }),
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// monitoringTick — isolation tests (no timers needed)
// ---------------------------------------------------------------------------

describe("monitoringTick — diff loop logic", () => {
  beforeEach(() => {
    mockListContainers.mockClear()
  })

  it("does NOT emit on first tick (no prev state)", async () => {
    const prev = new Map<string, ContainerStatus>()
    const publishSpy = spyOn(eventBus, "publish")

    const fakeAgent = {
      listContainers: () =>
        Promise.resolve({
          containers: [
            {
              id: "ctr-1",
              name: "ploydok-web",
              image: "nginx:alpine",
              status: "running",
              uptimeS: 10,
              cpuPct: 1,
              memBytes: 1024,
              memLimitBytes: 2048,
              restartCount: 0,
              kind: "app",
              appId: "app-abc",
              color: "blue",
              lastPingMs: 0,
              lastPingOk: false,
              lastSeenMs: 0,
            },
          ],
        }),
    } as unknown as Parameters<typeof monitoringTick>[0]

    await monitoringTick(fakeAgent, eventBus.publish.bind(eventBus), prev, () =>
      Promise.resolve("user-1"),
    )

    // First tick populates prevById but emits nothing.
    expect(publishSpy).not.toHaveBeenCalled()
    expect(prev.get("ctr-1")).toBe("running")

    publishSpy.mockRestore()
  })

  it("emits container.health on 2nd tick when status changes", async () => {
    const prev = new Map<string, ContainerStatus>([["ctr-1", "running"]])

    const publishedEvents: Parameters<typeof eventBus.publish>[] = []
    const fakePub = (channel: string, event: Parameters<typeof eventBus.publish>[1]) => {
      publishedEvents.push([channel, event])
    }

    const fakeAgent = {
      listContainers: () =>
        Promise.resolve({
          containers: [
            {
              id: "ctr-1",
              name: "ploydok-web",
              image: "nginx:alpine",
              status: "unhealthy", // changed!
              uptimeS: 60,
              cpuPct: 2,
              memBytes: 2048,
              memLimitBytes: 4096,
              restartCount: 1,
              kind: "app",
              appId: "app-abc",
              color: "blue",
              lastPingMs: 0,
              lastPingOk: false,
              lastSeenMs: 0,
            },
          ],
        }),
    } as unknown as Parameters<typeof monitoringTick>[0]

    await monitoringTick(fakeAgent, fakePub as typeof eventBus.publish, prev, () =>
      Promise.resolve("user-1"),
    )

    expect(publishedEvents.length).toBe(1)
    const [channel, event] = publishedEvents[0]!
    expect(channel).toBe("user:user-1")
    expect(event.type).toBe("container.health")
    expect(event.appId).toBe("app-abc")
    expect((event.data as { prev_status: string }).prev_status).toBe("running")

    // prevById should be updated to new status
    expect(prev.get("ctr-1")).toBe("unhealthy")
  })

  it("skips infra containers — no event published", async () => {
    const prev = new Map<string, ContainerStatus>([["ctr-infra", "running"]])

    const publishedEvents: Parameters<typeof eventBus.publish>[] = []
    const fakePub = (channel: string, event: Parameters<typeof eventBus.publish>[1]) => {
      publishedEvents.push([channel, event])
    }

    const fakeAgent = {
      listContainers: () =>
        Promise.resolve({
          containers: [
            {
              id: "ctr-infra",
              name: "ploydok-caddy",
              image: "caddy:2",
              status: "stopped", // changed!
              uptimeS: 0,
              cpuPct: 0,
              memBytes: 0,
              memLimitBytes: 0,
              restartCount: 0,
              kind: "infra",
              appId: "",
              color: "",
              lastPingMs: 0,
              lastPingOk: false,
              lastSeenMs: 0,
            },
          ],
        }),
    } as unknown as Parameters<typeof monitoringTick>[0]

    await monitoringTick(fakeAgent, fakePub as typeof eventBus.publish, prev, () =>
      Promise.resolve("user-1"),
    )

    // Infra containers must NOT publish events (MVP skip).
    expect(publishedEvents.length).toBe(0)
  })
})
