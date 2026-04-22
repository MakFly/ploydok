// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { databases, app_db_links, projects } from "@ploydok/db"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { requireTotpVerified } from "../auth/second-factor"
import { spawnDatabase, getConnectionString } from "../databases/spawner"
import { getSharedAgent } from "../debug/singletons"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("databases.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

const KindEnum = z.enum(["postgres", "redis", "mongo"])
const PlanEnum = z.enum(["small", "medium", "large"])

const CreateDatabaseBody = z.object({
  projectId: z.string().min(1),
  kind: KindEnum,
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with dashes"),
  plan: PlanEnum,
})

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
    const { projectId, kind, name, plan } = parsed.data

    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.owner_id, user.id)))
      .limit(1)
    if (!projectRows[0]) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404)
    }

    try {
      const result = await spawnDatabase(db, { projectId, kind, name, plan })
      return c.json({ id: result.id }, 201)
    } catch (err) {
      log.error({ err, projectId, kind, name }, "database spawn failed")
      return c.json({ error: { code: "SPAWN_ERROR", message: "Failed to spawn database" } }, 500)
    }
  })

  // GET /databases?projectId=... — list databases without connection strings
  router.get("/", async (c) => {
    const user = getUser(c)
    const projectId = c.req.query("projectId")

    const conditions = [eq(projects.owner_id, user.id)]
    if (projectId) {
      conditions.push(eq(databases.project_id, projectId))
    }

    const rows = await db
      .select({
        id: databases.id,
        project_id: databases.project_id,
        kind: databases.kind,
        name: databases.name,
        plan: databases.plan,
        status: databases.status,
        host: databases.host,
        port: databases.port,
        rotation_schedule: databases.rotation_schedule,
        password_rotated_at: databases.password_rotated_at,
        created_at: databases.created_at,
      })
      .from(databases)
      .innerJoin(projects, eq(databases.project_id, projects.id))
      .where(and(...conditions))

    return c.json(rows)
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
      id: row.id,
      project_id: row.project_id,
      kind: row.kind,
      name: row.name,
      plan: row.plan,
      status: row.status,
      host: row.host,
      port: row.port,
      rotation_schedule: row.rotation_schedule,
      password_rotated_at: row.password_rotated_at,
      created_at: row.created_at,
      linked_apps: links,
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

  // DELETE /databases/:id — TOTP + confirm challenge
  router.delete("/:id", totpMiddleware, async (c) => {
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
