// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from "drizzle-orm"
import { existsSync } from "node:fs"
import type { Db } from "@ploydok/db"

export type ComponentStatus = "ok" | "degraded" | "down" | "unknown"

export interface HealthReport {
  ok: boolean
  version: string
  components: {
    db: { status: ComponentStatus; latency_ms?: number; error?: string }
    agent: { status: ComponentStatus; socket?: string; error?: string }
    caddy: { status: ComponentStatus; admin_url?: string; error?: string }
  }
}

const AGENT_SOCKET_PATH = "/tmp/ploydok-agent.sock"
const CADDY_ADMIN_URL = "http://127.0.0.1:2020/config/"

async function checkDb(db: Db): Promise<HealthReport["components"]["db"]> {
  const start = Date.now()
  try {
    await db.execute(sql`SELECT 1`)
    return { status: "ok", latency_ms: Date.now() - start }
  } catch (err) {
    return { status: "down", error: (err as Error).message }
  }
}

function checkAgent(): HealthReport["components"]["agent"] {
  try {
    if (existsSync(AGENT_SOCKET_PATH)) {
      return { status: "ok", socket: AGENT_SOCKET_PATH }
    }
    return {
      status: "down",
      socket: AGENT_SOCKET_PATH,
      error: "socket file not found",
    }
  } catch (err) {
    return { status: "unknown", error: (err as Error).message }
  }
}

async function checkCaddy(): Promise<HealthReport["components"]["caddy"]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1000)
    const res = await fetch(CADDY_ADMIN_URL, { signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) return { status: "ok", admin_url: CADDY_ADMIN_URL }
    return {
      status: "degraded",
      admin_url: CADDY_ADMIN_URL,
      error: `HTTP ${res.status}`,
    }
  } catch (err) {
    return {
      status: "down",
      admin_url: CADDY_ADMIN_URL,
      error: (err as Error).message,
    }
  }
}

export async function buildHealthReport(
  db: Db,
  version: string
): Promise<HealthReport> {
  const [dbStatus, caddyStatus] = await Promise.all([checkDb(db), checkCaddy()])
  const agentStatus = checkAgent()

  const ok =
    dbStatus.status === "ok" &&
    agentStatus.status !== "down" &&
    caddyStatus.status !== "down"

  return {
    ok,
    version,
    components: {
      db: dbStatus,
      agent: agentStatus,
      caddy: caddyStatus,
    },
  }
}

export interface PublicStatus {
  status: "operational" | "degraded" | "down"
  version: string
  components: {
    db: ComponentStatus
    agent: ComponentStatus
    caddy: ComponentStatus
  }
}

export async function buildPublicStatus(
  db: Db,
  version: string
): Promise<PublicStatus> {
  const [dbStatus, caddyStatus] = await Promise.all([checkDb(db), checkCaddy()])
  const agentStatus = checkAgent()

  const ok =
    dbStatus.status === "ok" &&
    agentStatus.status !== "down" &&
    caddyStatus.status !== "down"

  return {
    status: ok ? "operational" : "degraded",
    version,
    components: {
      db: dbStatus.status,
      agent: agentStatus.status,
      caddy: caddyStatus.status,
    },
  }
}
