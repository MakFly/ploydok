// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { and, eq, isNotNull } from "drizzle-orm"
import {
  apps,
  databases,
  app_db_links,
  secrets,
  projects,
  memberships,
} from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { nanoid } from "nanoid"
import { getConnectionString } from "../databases/spawner"
import { normalizePostgresConnectionString } from "../databases/connection-strings"
import { encryptSecret } from "../secrets/crypto"
import { getAppForUser } from "@ploydok/db/queries"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("apps-databases-link.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

const LinkBody = z.object({
  env_prefix: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_]+$/)
    .optional()
    .default("DATABASE"),
})

export function parseConnectionString(
  kind: "postgres" | "mysql" | "mariadb" | "redis" | "mongo" | "libsql",
  connString: string,
  prefix: string
): Record<string, string> {
  const normalizedConnString =
    kind === "postgres"
      ? normalizePostgresConnectionString(connString)
      : connString
  const url = new URL(normalizedConnString)
  const vars: Record<string, string> = {}

  switch (kind) {
    case "postgres":
    case "mysql":
    case "mariadb":
      vars[`${prefix}_URL`] = normalizedConnString
      vars[`${prefix}_HOST`] = url.hostname
      vars[`${prefix}_PORT`] =
        url.port || (kind === "postgres" ? "5432" : "3306")
      vars[`${prefix}_USER`] = decodeURIComponent(url.username)
      vars[`${prefix}_PASSWORD`] = decodeURIComponent(url.password)
      vars[`${prefix}_NAME`] = url.pathname.replace(/^\//, "")
      break
    case "redis":
      vars[`${prefix}_URL`] = connString
      vars[`${prefix}_HOST`] = url.hostname
      vars[`${prefix}_PORT`] = url.port || "6379"
      vars[`${prefix}_PASSWORD`] = decodeURIComponent(url.password)
      break
    case "mongo":
      vars[`${prefix}_URL`] = connString
      vars[`${prefix}_HOST`] = url.hostname
      vars[`${prefix}_PORT`] = url.port || "27017"
      vars[`${prefix}_USER`] = decodeURIComponent(url.username)
      vars[`${prefix}_PASSWORD`] = decodeURIComponent(url.password)
      vars[`${prefix}_NAME`] =
        url.pathname.replace(/^\//, "").split("?")[0] ?? ""
      break
    case "libsql":
      vars[`${prefix}_URL`] = connString
      vars[`${prefix}_HOST`] = url.hostname
      vars[`${prefix}_PORT`] = url.port || "8080"
      vars[`${prefix}_USER`] = decodeURIComponent(url.username || "libsql")
      vars[`${prefix}_PASSWORD`] = decodeURIComponent(url.password)
      break
  }

  return vars
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAppsDatabasesLinkRouter(db: Db): Hono<any, any, any> {
  const router = new Hono<AppEnv>()

  // POST /apps/:id/databases/:dbId/link
  router.post("/:id/databases/:dbId/link", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const dbId = c.req.param("dbId")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const dbRows = await db
      .select({ db: databases })
      .from(databases)
      .innerJoin(projects, eq(databases.project_id, projects.id))
      .innerJoin(
        memberships,
        and(
          eq(memberships.org_id, projects.id),
          eq(memberships.user_id, user.id),
          isNotNull(memberships.accepted_at)
        )
      )
      .where(eq(databases.id, dbId))
      .limit(1)
    const dbRow = dbRows[0]?.db
    if (!dbRow) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Database not found" } },
        404
      )
    }

    if (dbRow.project_id !== app.project_id) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Database and app must belong to the same project",
          },
        },
        403
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const parsed = LinkBody.safeParse(body)
    if (!parsed.success) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: parsed.error.message } },
        400
      )
    }
    const { env_prefix } = parsed.data

    let connString: string
    try {
      connString = await getConnectionString(dbRow)
    } catch {
      return c.json(
        {
          error: {
            code: "UNAVAILABLE",
            message: "Connection string not available",
          },
        },
        503
      )
    }

    const vars = parseConnectionString(
      dbRow.kind as
        | "postgres"
        | "mysql"
        | "mariadb"
        | "redis"
        | "mongo"
        | "libsql",
      connString,
      env_prefix
    )

    // Delete existing linked secrets for this (app, db) pair with same prefix
    await db
      .delete(secrets)
      .where(
        and(eq(secrets.app_id, appId), eq(secrets.linked_database_id, dbId))
      )

    // Delete existing link row if any (for upsert)
    await db
      .delete(app_db_links)
      .where(
        and(eq(app_db_links.app_id, appId), eq(app_db_links.database_id, dbId))
      )

    const now = new Date()

    // Insert secrets for each var
    for (const [key, value] of Object.entries(vars)) {
      const { enc, nonce } = await encryptSecret(value)
      await db.insert(secrets).values({
        id: nanoid(),
        app_id: appId,
        project_id: app.project_id,
        scope: "shared",
        key,
        value_ciphertext: enc,
        nonce,
        linked_database_id: dbId,
        created_at: now,
      })
    }

    // Insert link row
    await db.insert(app_db_links).values({
      id: nanoid(),
      app_id: appId,
      database_id: dbId,
      env_prefix,
      created_at: now,
    })

    log.info(
      { appId, dbId, env_prefix, vars: Object.keys(vars) },
      "database linked to app"
    )
    return c.json({ ok: true, vars: Object.keys(vars) }, 201)
  })

  // DELETE /apps/:id/databases/:dbId/link
  router.delete("/:id/databases/:dbId/link", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const dbId = c.req.param("dbId")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    // Verify DB belongs to user via membership
    const dbRows = await db
      .select({ id: databases.id })
      .from(databases)
      .innerJoin(projects, eq(databases.project_id, projects.id))
      .innerJoin(
        memberships,
        and(
          eq(memberships.org_id, projects.id),
          eq(memberships.user_id, user.id),
          isNotNull(memberships.accepted_at)
        )
      )
      .where(eq(databases.id, dbId))
      .limit(1)
    if (!dbRows[0]) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Database not found" } },
        404
      )
    }

    // Delete linked secrets
    await db
      .delete(secrets)
      .where(
        and(eq(secrets.app_id, appId), eq(secrets.linked_database_id, dbId))
      )

    // Delete link row
    await db
      .delete(app_db_links)
      .where(
        and(eq(app_db_links.app_id, appId), eq(app_db_links.database_id, dbId))
      )

    log.info({ appId, dbId }, "database unlinked from app")
    return c.json({ ok: true })
  })

  return router
}
