// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"
import { createRedis } from "@ploydok/db"
import type { DatabaseRow, Db } from "@ploydok/db"
import { env } from "../env"
import { getConnectionString } from "../databases/spawner"
import { ensureProjectNetwork } from "../services/projects"
import { getSharedAgent } from "../debug/singletons"
import type { Agent } from "../agent"
import { isAlreadyExists, isNotFound, toAgentError } from "../agent/index.js"
import { childLogger } from "../logger"

const log = childLogger("adminer")

const ADMINER_SESSION_TTL_SECONDS = 30 * 60
const ADMINER_REDIS_PREFIX = "adminer:session:"
const ADMINER_CONTAINER_NAMES = [
  "ploydok-adminer",
  "ploydok-adminer-1",
] as const

const SUPPORTED_SQL_KINDS = new Set(["postgres", "mysql", "mariadb"])

let cachedAdminerId: string | null = null

export interface AdminerSession {
  token: string
  userId: string
  databaseId: string
  projectId: string
  driver: "pgsql" | "server"
  server: string
  database: string
  username: string
  createdAt: string
  expiresAt: string
}

export interface AdminerLaunch {
  path: string
  expires_at: string
  driver: AdminerSession["driver"]
  server: string
  database: string
  username: string
}

function redisKey(token: string): string {
  return `${ADMINER_REDIS_PREFIX}${token}`
}

function adminerDriverForKind(kind: string): AdminerSession["driver"] | null {
  if (kind === "postgres") return "pgsql"
  if (kind === "mysql" || kind === "mariadb") return "server"
  return null
}

export function isAdminerSupportedDatabase(row: DatabaseRow): boolean {
  return row.management_mode === "managed" && SUPPORTED_SQL_KINDS.has(row.kind)
}

function parseSqlConnectionTarget(
  row: DatabaseRow,
  connectionString: string
): Pick<AdminerSession, "driver" | "server" | "database" | "username"> {
  const driver = adminerDriverForKind(row.kind)
  if (!driver) {
    throw new Error(`Adminer is not supported for ${row.kind} databases`)
  }
  if (!row.host || !row.port) {
    throw new Error("Database internal endpoint is not available")
  }

  const url = new URL(connectionString)
  return {
    driver,
    server: `${row.host}:${row.port}`,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "app",
    username: decodeURIComponent(url.username),
  }
}

async function resolveAdminerContainerId(agent: Agent): Promise<string> {
  if (cachedAdminerId) return cachedAdminerId
  const { containers } = await agent.listContainers({ kindFilter: "" })
  for (const candidate of ADMINER_CONTAINER_NAMES) {
    const match = containers.find(
      (container) =>
        container.name === candidate || container.name === `/${candidate}`
    )
    if (match) {
      cachedAdminerId = match.id
      return match.id
    }
  }
  throw new Error(
    `Adminer container not found (expected one of ${ADMINER_CONTAINER_NAMES.join(", ")})`
  )
}

export function resetAdminerContainerCache(): void {
  cachedAdminerId = null
}

export async function ensureAdminerOnProjectNetwork(
  agent: Agent,
  projectNetwork: string
): Promise<void> {
  const adminerId = await resolveAdminerContainerId(agent)
  try {
    await agent.networkConnect({
      networkId: projectNetwork,
      containerId: adminerId,
      aliases: [],
    })
    log.info(
      { projectNetwork, adminerId },
      "adminer attached to project network"
    )
  } catch (err) {
    const agentErr = toAgentError(err)
    if (isAlreadyExists(agentErr)) {
      return
    }
    if (isNotFound(agentErr) && /container/i.test(agentErr.details)) {
      resetAdminerContainerCache()
      const freshId = await resolveAdminerContainerId(agent)
      await agent.networkConnect({
        networkId: projectNetwork,
        containerId: freshId,
        aliases: [],
      })
      return
    }
    throw err
  }
}

export async function createAdminerSession(
  db: Db,
  row: DatabaseRow,
  userId: string
): Promise<AdminerLaunch> {
  if (!isAdminerSupportedDatabase(row)) {
    throw new Error("Adminer is only available for managed SQL databases")
  }
  if (row.status !== "running") {
    throw new Error("Database must be running before opening Adminer")
  }

  const agent = getSharedAgent()
  const networkName = await ensureProjectNetwork(db, row.project_id, agent)
  await ensureAdminerOnProjectNetwork(agent, networkName)

  const connectionString = await getConnectionString(row)
  const target = parseSqlConnectionTarget(row, connectionString)
  const token = nanoid(40)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ADMINER_SESSION_TTL_SECONDS * 1000)
  const session: AdminerSession = {
    token,
    userId,
    databaseId: row.id,
    projectId: row.project_id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...target,
  }

  const redis = createRedis(env.REDIS_URL)
  try {
    await redis.set(
      redisKey(token),
      JSON.stringify(session),
      "EX",
      ADMINER_SESSION_TTL_SECONDS
    )
  } finally {
    redis.disconnect()
  }

  const query = new URLSearchParams({
    [session.driver]: session.server,
  })

  return {
    path: `/adminer/sessions/${token}/?${query.toString()}`,
    expires_at: session.expiresAt,
    driver: session.driver,
    server: session.server,
    database: session.database,
    username: session.username,
  }
}

export async function getAdminerSession(
  token: string,
  userId: string
): Promise<AdminerSession | null> {
  const redis = createRedis(env.REDIS_URL)
  try {
    const raw = await redis.get(redisKey(token))
    if (!raw) return null
    const session = JSON.parse(raw) as AdminerSession
    if (session.userId !== userId) return null
    if (Date.parse(session.expiresAt) <= Date.now()) return null
    return session
  } finally {
    redis.disconnect()
  }
}
