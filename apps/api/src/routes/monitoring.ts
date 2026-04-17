// SPDX-License-Identifier: AGPL-3.0-only
//
// Monitoring routes — overview snapshot + active ping + diff loop → SSE.
//
// Endpoints:
//   GET  /monitoring/overview       — snapshot courant (MonitoringOverview)
//   POST /monitoring/ping/:id       — HTTP ping actif, renvoie latency + ok
//
// Diff loop:
//   polls agent.listContainers() toutes les 5s
//   diff avec le snapshot précédent (par container.id)
//   n'émet sur eventBus (channel user:{userId}) QUE si container.status change
//   le userId est résolu via label ploydok.app_id → resolveAppOwner()

import { Hono } from "hono"
import { z } from "zod"
import { nanoid } from "nanoid"
import { eventBus } from "../worker/event-bus"
import { getSharedAgent } from "../debug/singletons"
import {
  ContainerSnapshotSchema,
  type ContainerSnapshot,
  type ContainerStatus,
  type MonitoringOverview,
} from "@ploydok/shared"
import { resolveAppOwner } from "../queries/app-owner"
import { createDb } from "@ploydok/db"
import { env } from "../env"
import { childLogger } from "../logger"
import { AgentError } from "../agent/errors"
import type { AuthUser } from "../auth/middleware"
import type { Agent } from "../agent/wrapper"

const log = childLogger("monitoring")

// Erreur agent — payload stable pour /overview quand l'agent est injoignable.
function agentErrorPayload(err: unknown): { code: string; message: string } {
  if (err instanceof AgentError) {
    return {
      code: err.code === 14 ? "AGENT_UNAVAILABLE" : "AGENT_ERROR",
      message:
        err.code === 14
          ? "Agent Ploydok injoignable (démarre-le avec `make dev-agent`)"
          : err.message,
    }
  }
  return { code: "AGENT_ERROR", message: (err as Error).message ?? "unknown" }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const monitoringRouter = new Hono<{ Variables: { user?: AuthUser } }>()

// ---------------------------------------------------------------------------
// Helper — snapshot from agent
// ---------------------------------------------------------------------------

async function snapshotFromAgent(): Promise<MonitoringOverview> {
  const agent = getSharedAgent()
  const { containers: protoContainers } = await agent.listContainers({ kindFilter: "" })

  const containers: ContainerSnapshot[] = []
  const now = Date.now()

  for (const c of protoContainers) {
    const raw = {
      id: c.id,
      name: c.name,
      image: c.image,
      status: c.status || "unknown",
      uptime_s: c.uptimeS,
      cpu_pct: c.cpuPct,
      mem_bytes: c.memBytes,
      mem_limit_bytes: c.memLimitBytes,
      restart_count: c.restartCount,
      kind: c.kind || undefined,
      app_id: c.appId || undefined,
      color: c.color || undefined,
      last_ping_ms: c.lastPingMs > 0 ? c.lastPingMs : undefined,
      last_ping_ok: c.lastPingMs > 0 ? c.lastPingOk : undefined,
      last_seen_ms: c.lastSeenMs > 0 ? c.lastSeenMs : now,
    }

    const parsed = ContainerSnapshotSchema.safeParse(raw)
    if (parsed.success) {
      containers.push(parsed.data)
    } else {
      log.warn({ containerId: c.id, issues: parsed.error.issues }, "snapshot validation failed — skipping container")
    }
  }

  return { containers, generated_at: now }
}

// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------

monitoringRouter.get("/overview", async (c) => {
  const user = c.get("user") as AuthUser | undefined

  if (!user) {
    return c.json(
      { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
      401,
    )
  }

  try {
    const overview = await snapshotFromAgent()
    return c.json(overview)
  } catch (err) {
    return c.json<MonitoringOverview>(
      {
        containers: [],
        generated_at: Date.now(),
        error: agentErrorPayload(err),
      },
      503,
    )
  }
})

// ---------------------------------------------------------------------------
// POST /ping/:id
// ---------------------------------------------------------------------------

const PingBodySchema = z.object({
  path: z.string().min(1).max(256),
  port: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(),
})

monitoringRouter.post("/ping/:id", async (c) => {
  const user = c.get("user") as AuthUser | undefined

  if (!user) {
    return c.json(
      { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
      401,
    )
  }

  const id = c.req.param("id")

  // Parse + validate body
  let bodyRaw: unknown
  try {
    bodyRaw = await c.req.json()
  } catch {
    return c.json({ error: { code: "INVALID_BODY", message: "Invalid JSON body" } }, 400)
  }

  const parsed = PingBodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: parsed.error.issues } },
      400,
    )
  }

  const { path, port, timeoutMs } = parsed.data

  // Ownership check — if the container belongs to an app, verify ownership.
  // To resolve app_id we do a snapshot and find the container by id.
  const overview = await snapshotFromAgent()
  const container = overview.containers.find((ct) => ct.id === id)

  if (container?.app_id) {
    // This is an "app" container — verify ownership via resolveAppOwner.
    // We can't access the db here from the router directly, so we rely on
    // the app-level db created in app.ts. For the router, we accept that
    // the check below uses the shared agent and a fresh db from env.
    // Note: for MVP, we create a db instance here. In production this would
    // be injected. Since createDb is cheap with libsql, this is acceptable.
    const db = createDb(env.DATABASE_URL)
    const ownerId = await resolveAppOwner(db, container.app_id)
    if (ownerId !== user.id) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "You do not own this container" } },
        403,
      )
    }
  }
  // If no app_id (infra/agent containers), allow any authenticated user (MVP).

  const agent = getSharedAgent()
  const result = await agent.pingContainer({
    containerId: id,
    path,
    port,
    timeoutMs: timeoutMs ?? 2000,
  })

  return c.json({
    ok: result.ok,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    error: result.error,
  })
})

// ---------------------------------------------------------------------------
// Diff loop — exported for lifecycle management + testability
// ---------------------------------------------------------------------------

let prevById = new Map<string, ContainerStatus>()
let loopHandle: ReturnType<typeof setInterval> | null = null
let consecutiveFailures = 0

/**
 * Pure tick function — extracted for testability.
 * Takes the agent, a publish function, the prev-state map and an owner resolver.
 */
export async function monitoringTick(
  agent: Agent,
  publish: typeof eventBus.publish,
  prev: Map<string, ContainerStatus>,
  resolveOwner: (appId: string) => Promise<string | null>,
): Promise<void> {
  const now = Date.now()
  const { containers: protoContainers } = await agent.listContainers({ kindFilter: "" })

  for (const c of protoContainers) {
    const raw = {
      id: c.id,
      name: c.name,
      image: c.image,
      status: c.status || "unknown",
      uptime_s: c.uptimeS,
      cpu_pct: c.cpuPct,
      mem_bytes: c.memBytes,
      mem_limit_bytes: c.memLimitBytes,
      restart_count: c.restartCount,
      kind: c.kind || undefined,
      app_id: c.appId || undefined,
      color: c.color || undefined,
      last_ping_ms: c.lastPingMs > 0 ? c.lastPingMs : undefined,
      last_ping_ok: c.lastPingMs > 0 ? c.lastPingOk : undefined,
      last_seen_ms: c.lastSeenMs > 0 ? c.lastSeenMs : now,
    }

    const parsed = ContainerSnapshotSchema.safeParse(raw)
    if (!parsed.success) continue

    const container = parsed.data
    const prevStatus = prev.get(container.id)
    const currentStatus = container.status

    // Only emit events if status changed AND we have a previous state.
    if (prevStatus !== undefined && prevStatus !== currentStatus) {
      if (container.kind === "app" && container.app_id) {
        try {
          const userId = await resolveOwner(container.app_id)
          if (userId) {
            publish(`user:${userId}`, {
              id: nanoid(),
              type: "container.health",
              appId: container.app_id,
              message: `Container ${container.name} status changed: ${prevStatus} → ${currentStatus}`,
              t: now,
              data: { container, prev_status: prevStatus },
            })
          }
        } catch (err) {
          log.warn({ containerId: container.id, err }, "resolveOwner failed during monitoring tick")
        }
      }
      // Infra/agent containers: skip for MVP.
    }

    prev.set(container.id, currentStatus)
  }
}

export function startMonitoringLoop(db: ReturnType<typeof createDb>): void {
  if (loopHandle !== null) return

  const agent = getSharedAgent()
  const resolveOwner = (appId: string) => resolveAppOwner(db, appId)

  loopHandle = setInterval(() => {
    monitoringTick(agent, eventBus.publish.bind(eventBus), prevById, resolveOwner)
      .then(() => {
        if (consecutiveFailures > 0) {
          log.info({ afterFailures: consecutiveFailures }, "monitoring tick recovered")
          consecutiveFailures = 0
        }
      })
      .catch((err) => {
        consecutiveFailures += 1
        // Log niveau warn sur les 2 premiers échecs, puis debug pour éviter le spam.
        if (consecutiveFailures <= 2) {
          log.warn({ err, consecutiveFailures }, "monitoring tick error")
        } else {
          log.debug({ err, consecutiveFailures }, "monitoring tick error (silenced)")
        }
      })
  }, 5_000)

  log.info("monitoring loop started (interval=5s)")
}

export function stopMonitoringLoop(): void {
  if (loopHandle !== null) {
    clearInterval(loopHandle)
    loopHandle = null
    prevById = new Map()
    consecutiveFailures = 0
    log.info("monitoring loop stopped")
  }
}
