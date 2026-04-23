// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { databases, app_db_links, projects } from "@ploydok/db"
import { createDb } from "@ploydok/db"
import type { DatabaseRow, Db } from "@ploydok/db"
import { env } from "../env"
import { requireTotpVerified } from "../auth/second-factor"
import {
  spawnDatabase,
  getConnectionString,
  recreateDatabaseContainer,
  removeDatabasePublicProxy,
  startDatabaseContainer,
  stopDatabaseContainer,
} from "../databases/spawner"
import { rotatePassword, RotationInProgressError, RotationFailedError } from "../databases/rotation"
import { getSharedAgent } from "../debug/singletons"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"
import { ensureDefaultOrganizationForUser } from "../services/organizations"

const log = childLogger("databases.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

const KindEnum = z.enum(["postgres", "mysql", "mariadb", "redis", "mongo"])
const PlanEnum = z.enum(["small", "medium", "large"])
const ExposureModeEnum = z.enum(["internal", "direct_port", "public_proxy"])

const CreateDatabaseBody = z.object({
  organizationId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  kind: KindEnum,
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with dashes"),
  plan: PlanEnum,
  exposureMode: ExposureModeEnum.optional(),
  publicEnabled: z.boolean().optional(),
}).or(z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  kind: KindEnum,
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with dashes"),
  plan: PlanEnum,
  exposureMode: ExposureModeEnum.optional(),
  publicEnabled: z.boolean().optional(),
}))

const UpdateNetworkBody = z.object({
  exposureMode: ExposureModeEnum.default("internal"),
  publicEnabled: z.boolean().default(false),
})

function listShape(row: DatabaseRow) {
  return {
    id: row.id,
    // See serializeApp() in routes/apps.ts for the rationale on why
    // organization_id and project_id are both projections of projects.id.
    organization_id: row.project_id,
    project_id: row.project_id,
    kind: row.kind,
    version: row.version,
    name: row.name,
    plan: row.plan,
    status: row.status,
    health_status: row.health_status,
    host: row.host,
    port: row.port,
    internal_host: row.host,
    internal_port: row.port,
    exposure_mode: row.exposure_mode,
    public_enabled: row.public_enabled,
    public_host: row.public_host,
    public_port: row.public_port,
    public_url: row.public_url,
    rotation_schedule: row.rotation_schedule,
    rotation_in_progress: row.rotation_in_progress,
    password_rotated_at: row.password_rotated_at,
    last_started_at: row.last_started_at,
    created_at: row.created_at,
  }
}

async function getDbForUser(
  db: Db,
  dbId: string,
  userId: string,
) {
  const rows = await db
    .select({ db: databases })
    .from(databases)
    .innerJoin(projects, eq(databases.project_id, projects.id))
    .where(and(eq(databases.id, dbId), eq(projects.owner_id, userId)))
    .limit(1)
  return rows[0]?.db ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDatabasesRouter(db: Db): Hono<any, any, any> {
  const router = new Hono<AppEnv>()
  const totpMiddleware = requireTotpVerified(db)

  // POST /databases — spawn a new managed database
  router.post("/", async (c) => {
    const user = getUser(c)
    const body = await c.req.json().catch(() => null)
    const parsed = CreateDatabaseBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400)
    }
    const { kind, name, plan } = parsed.data
    const exposureMode = parsed.data.exposureMode ?? "internal"
    const publicEnabled = parsed.data.publicEnabled ?? false
    const requestedOrganizationId = parsed.data.organizationId ?? parsed.data.projectId
    const projectId = requestedOrganizationId
      ? requestedOrganizationId
      : (await ensureDefaultOrganizationForUser(db, user.id, user.display_name)).id

    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.owner_id, user.id)))
      .limit(1)
    if (!projectRows[0]) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404)
    }

    try {
      const result = await spawnDatabase(db, {
        projectId,
        ownerId: user.id,
        kind,
        name,
        plan,
        exposureMode,
        publicEnabled,
      })
      return c.json({ id: result.id }, 201)
    } catch (err) {
      log.error({ err, projectId, kind, name }, "database spawn failed")
      return c.json({ error: { code: "SPAWN_ERROR", message: "Failed to spawn database" } }, 500)
    }
  })

  // GET /databases?projectId=... — list databases without connection strings
  router.get("/", async (c) => {
    const user = getUser(c)
    const projectId = c.req.query("projectId") ?? c.req.query("organizationId")

    const conditions = [eq(projects.owner_id, user.id)]
    if (projectId) {
      conditions.push(eq(databases.project_id, projectId))
    }

    const rows = await db
      .select({ db: databases })
      .from(databases)
      .innerJoin(projects, eq(databases.project_id, projects.id))
      .where(and(...conditions))

    return c.json(rows.map((row) => listShape(row.db)))
  })

  // GET /databases/:id — detail without connection string plaintext
  router.get("/:id", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const row = await getDbForUser(db, dbId, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }

    const links = await db
      .select({ app_id: app_db_links.app_id, env_prefix: app_db_links.env_prefix })
      .from(app_db_links)
      .where(eq(app_db_links.database_id, dbId))

    return c.json({
      ...listShape(row),
      linked_apps: links,
      connections: {
        internal: {
          host: row.host,
          port: row.port,
        },
        public: row.public_enabled
          ? {
            exposure_mode: row.exposure_mode,
            host: row.public_host,
            port: row.public_port,
            url: row.public_url,
          }
          : null,
      },
    })
  })

  // POST /databases/:id/reveal — TOTP required, returns connection string
  router.post("/:id/reveal", totpMiddleware, async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }

    try {
      const connectionString = await getConnectionString(row)
      return c.json({ connection_string: connectionString })
    } catch {
      return c.json({ error: { code: "UNAVAILABLE", message: "Connection string not available" } }, 503)
    }
  })

  // Statuses in which a mutation (start/stop/restart/network-change) is
  // already in flight. A second mutation kicked off from a double-click would
  // race with the first inside the spawner, double-calling containerStart /
  // containerCreate on the same db. Reject as CONFLICT; the client retries
  // once it sees the status settle.
  const BUSY_STATUSES = new Set<string>(["creating", "starting"])

  router.post("/:id/start", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")
    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }
    if (BUSY_STATUSES.has(row.status)) {
      return c.json({ error: { code: "CONFLICT", message: "Database is busy" } }, 409)
    }

    try {
      await startDatabaseContainer(db, row, { ownerId: user.id })
      return c.json({ ok: true })
    } catch (err) {
      log.error({ err, dbId: row.id }, "start database failed")
      return c.json({ error: { code: "START_FAILED", message: "Start failed" } }, 500)
    }
  })

  router.post("/:id/stop", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")
    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }
    if (BUSY_STATUSES.has(row.status)) {
      return c.json({ error: { code: "CONFLICT", message: "Database is busy" } }, 409)
    }

    try {
      await stopDatabaseContainer(db, row)
      return c.json({ ok: true })
    } catch (err) {
      log.error({ err, dbId: row.id }, "stop database failed")
      return c.json({ error: { code: "STOP_FAILED", message: "Stop failed" } }, 500)
    }
  })

  router.post("/:id/restart", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")
    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }
    if (BUSY_STATUSES.has(row.status)) {
      return c.json({ error: { code: "CONFLICT", message: "Database is busy" } }, 409)
    }

    try {
      await recreateDatabaseContainer(db, row, {
        exposureMode: row.exposure_mode as "internal" | "direct_port" | "public_proxy",
        publicEnabled: row.public_enabled,
        ownerId: user.id,
      })
      return c.json({ ok: true })
    } catch (err) {
      log.error({ err, dbId: row.id }, "restart database failed")
      return c.json({ error: { code: "RESTART_FAILED", message: "Restart failed" } }, 500)
    }
  })

  router.patch("/:id/network", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")
    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }
    if (BUSY_STATUSES.has(row.status)) {
      return c.json({ error: { code: "CONFLICT", message: "Database is busy" } }, 409)
    }

    const body = await c.req.json().catch(() => null)
    const parsed = UpdateNetworkBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400)
    }
    const nextNetwork = parsed.data

    try {
      const nextRow = await recreateDatabaseContainer(db, row, {
        exposureMode: nextNetwork.exposureMode,
        publicEnabled: nextNetwork.publicEnabled && nextNetwork.exposureMode !== "internal",
        ownerId: user.id,
      })
      return c.json({ ok: true, database: listShape(nextRow) })
    } catch (err) {
      log.error({ err, dbId: row.id }, "network update failed")
      return c.json({ error: { code: "NETWORK_UPDATE_FAILED", message: "Network update failed" } }, 500)
    }
  })

  router.get("/:id/logs", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")
    const tailRaw = Number(c.req.query("tail") ?? 200)
    const tail = Number.isFinite(tailRaw)
      ? Math.max(1, Math.min(Math.floor(tailRaw), 1_000))
      : 200
    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }
    if (!row.container_id) {
      return c.json({ lines: [], containerFound: false })
    }

    try {
      const agent = getSharedAgent()
      const lines: Array<{ t: number; line: string; stream?: "stdout" | "stderr" }> = []
      for await (const line of agent.containerLogs({
        containerId: row.container_id,
        follow: false,
        sinceUnix: 0,
        tail,
      })) {
        const entry: { t: number; line: string; stream?: "stdout" | "stderr" } = {
          t: Date.parse(line.timestamp) || Date.now(),
          line: line.line,
        }
        if (line.stream === "stdout" || line.stream === "stderr") entry.stream = line.stream
        lines.push(entry)
      }
      return c.json({ lines, containerFound: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "RUNTIME_LOGS_ERROR", message } }, 500)
    }
  })

  router.get("/:id/stats", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")
    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }
    if (!row.container_id) {
      return c.json({ containerFound: false })
    }

    try {
      const agent = getSharedAgent()
      for await (const frame of agent.containerStats({ containerId: row.container_id, stream: false })) {
        return c.json({
          containerFound: true,
          stats: {
            cpu_percent: frame.cpuPercent,
            memory_bytes: frame.memoryBytes,
            memory_limit_bytes: frame.memoryLimitBytes,
            net_rx_bytes: frame.netRxBytes,
            net_tx_bytes: frame.netTxBytes,
            timestamp_ns: frame.timestampNs,
          },
        })
      }
      return c.json({ containerFound: true, stats: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "RUNTIME_STATS_ERROR", message } }, 500)
    }
  })

  // POST /databases/:id/rotate — TOTP required, triggers password rotation
  router.post("/:id/rotate", totpMiddleware, async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }

    try {
      const result = await rotatePassword(db, row.id, { reason: "manual" })
      log.info({ dbId: row.id, userId: user.id, appsRedeployed: result.appsRedeployed }, "manual rotation triggered")
      return c.json({
        ok: true,
        rotatedAt: result.rotatedAt.toISOString(),
        appsRedeployed: result.appsRedeployed,
      })
    } catch (err) {
      if (err instanceof RotationInProgressError) {
        return c.json({ error: { code: "CONFLICT", message: "Rotation already in progress" } }, 409)
      }
      if (err instanceof RotationFailedError) {
        log.error({ err, dbId: row.id }, "rotation failed — rolled back")
        return c.json(
          { error: { code: "ROTATION_FAILED", message: "Rotation failed — rolled back to previous password" } },
          500,
        )
      }
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ err, dbId: row.id }, "unexpected rotation error")
      return c.json({ error: { code: "INTERNAL", message: msg } }, 500)
    }
  })

  // DELETE /databases/:id — confirm challenge
  router.delete("/:id", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const row = await getDbForUser(db, dbId!, user.id)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)
    }

    const body = await c.req.json().catch(() => null)
    const confirm = body?.confirm
    if (confirm !== `delete ${row.name}`) {
      return c.json(
        {
          error: {
            code: "CONFIRM_REQUIRED",
            message: `Send { "confirm": "delete ${row.name}" } to confirm deletion`,
          },
        },
        400,
      )
    }

    const agent = getSharedAgent()

    if (row.container_id) {
      try {
        await agent.containerStop({ containerId: row.container_id, timeoutSeconds: 10 })
        await agent.containerRemove({ containerId: row.container_id, force: false, removeVolumes: false })
      } catch (err) {
        log.warn({ err, dbId, containerId: row.container_id }, "container stop/remove warning")
      }
    }

    await removeDatabasePublicProxy(row)

    await db.delete(databases).where(eq(databases.id, dbId!))

    log.info({ dbId, name: row.name, userId: user.id }, "database deleted")
    return c.json({ ok: true })
  })

  return router
}

export function databasesRouterFactory() {
  const db = createDb(env.DATABASE_URL)
  return createDatabasesRouter(db)
}
