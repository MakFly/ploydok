// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { memberships, projects } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"
import { getSharedAgent } from "../debug/singletons.js"
import { childLogger } from "../logger"

const log = childLogger("docker-host")

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function isAdmin(db: Db, userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(eq(memberships.user_id, userId), eq(memberships.role, "owner"))
      )
      .limit(1)
    if (rows.length > 0) return true
  } catch {
    // memberships table missing — fall through to legacy check below.
  }
  const legacyRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.owner_id, userId))
    .limit(1)
  return legacyRows.length > 0
}

export function createDockerHostRouter(db: Db): Hono {
  const router = new Hono()

  router.get("/docker/containers", async (c) => {
    const user = getUser(c)
    if (!(await isAdmin(db, user.id))) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Admin access required" } },
        403
      )
    }
    try {
      const agent = getSharedAgent()
      const { containers } = await agent.listContainers({ kindFilter: "" })
      return c.json({ containers })
    } catch (err) {
      log.warn({ err }, "listContainers failed")
      return c.json(
        { error: { code: "AGENT_ERROR", message: "Agent unreachable" } },
        502
      )
    }
  })

  return router
}
