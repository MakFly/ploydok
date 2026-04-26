// SPDX-License-Identifier: AGPL-3.0-only
//
// Container file browser — read-only listing + content read for the shell sidebar.
//
// Endpoints (auth + owner gated, same posture as /ws/apps/:id/exec):
//   GET /apps/:id/files?path=/app                 → { path, entries[] }
//   GET /apps/:id/files/content?path=/etc/hostname → { path, content_b64,
//                                                     total_size, truncated, is_binary }

import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { createDb, apps, audit_log } from "@ploydok/db"
import { getAppForOwner } from "@ploydok/db/queries"
import { validateContainerPath } from "@ploydok/shared"
import { env } from "../env"
import { requireAuth } from "../auth/middleware"
import type { AuthUser } from "../auth/middleware"
import { getSharedAgent } from "../debug/singletons"
import { childLogger } from "../logger"

const log = childLogger("apps-files")

const db = createDb(env.DATABASE_URL)

type AppEnv = { Variables: { user?: AuthUser } }

export const appsFilesRouter = new Hono<AppEnv>()

appsFilesRouter.use("/apps/:id/files", requireAuth(db))
appsFilesRouter.use("/apps/:id/files/content", requireAuth(db))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function resolveContainer(
  appId: string,
  userId: string
): Promise<
  { ok: true; containerId: string } | { ok: false; status: 401 | 404 }
> {
  const owned = await getAppForOwner(db, appId, userId)
  if (!owned) return { ok: false, status: 401 }

  const row = await db
    .select({ container_id: apps.container_id })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1)
  const containerId = row[0]?.container_id
  if (!containerId) return { ok: false, status: 404 }

  return { ok: true, containerId }
}

function pathError(reason: string) {
  return {
    error: {
      code: "INVALID_PATH",
      message: `path validation failed: ${reason}`,
    },
  }
}

// ---------------------------------------------------------------------------
// GET /apps/:id/files
// ---------------------------------------------------------------------------

appsFilesRouter.get("/apps/:id/files", async (c) => {
  const user = getUser(c)
  const appId = c.req.param("id")
  if (!appId) return c.json({ error: "missing app id" }, 400)

  const path = c.req.query("path") ?? "/"
  const v = validateContainerPath(path)
  if (!v.ok) return c.json(pathError(v.reason ?? "unknown"), 400)

  const showHidden = c.req.query("show_hidden") === "1"

  const resolved = await resolveContainer(appId, user.id)
  if (!resolved.ok) {
    return c.json(
      { error: resolved.status === 401 ? "Unauthorized" : "no container" },
      resolved.status
    )
  }

  try {
    const agent = getSharedAgent()
    const res = await agent.listContainerFiles({
      containerId: resolved.containerId,
      path,
      showHidden,
    })

    db.insert(audit_log)
      .values({
        user_id: user.id,
        action: "app.files.list",
        target_type: "app",
        target_id: appId,
        metadata: JSON.stringify({ path, count: res.entries.length }),
        created_at: new Date(),
      })
      .catch((err: unknown) => {
        log.warn(
          { err: (err as Error).message, userId: user.id, appId },
          "files.list.audit_failed"
        )
      })

    return c.json({
      path: res.path,
      entries: res.entries.map((e) => ({
        name: e.name,
        path: e.path,
        is_dir: e.isDir,
        is_symlink: e.isSymlink,
        size: Number(e.size),
        mode: e.mode,
        mtime: Number(e.mtime),
        owner: e.owner,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "agent error"
    log.error({ err, appId, path }, "files.list.failed")
    return c.json({ error: { code: "AGENT_ERROR", message } }, 502)
  }
})

// ---------------------------------------------------------------------------
// GET /apps/:id/files/content
// ---------------------------------------------------------------------------

appsFilesRouter.get("/apps/:id/files/content", async (c) => {
  const user = getUser(c)
  const appId = c.req.param("id")
  if (!appId) return c.json({ error: "missing app id" }, 400)

  const path = c.req.query("path") ?? ""
  const v = validateContainerPath(path)
  if (!v.ok) return c.json(pathError(v.reason ?? "unknown"), 400)

  // Optional override (capped server-side at 1 MiB by the agent).
  const maxBytesRaw = c.req.query("max_bytes")
  const maxBytes = maxBytesRaw ? Math.max(0, parseInt(maxBytesRaw, 10) || 0) : 0

  const resolved = await resolveContainer(appId, user.id)
  if (!resolved.ok) {
    return c.json(
      { error: resolved.status === 401 ? "Unauthorized" : "no container" },
      resolved.status
    )
  }

  try {
    const agent = getSharedAgent()
    const res = await agent.readContainerFile({
      containerId: resolved.containerId,
      path,
      maxBytes,
    })

    db.insert(audit_log)
      .values({
        user_id: user.id,
        action: "app.files.read",
        target_type: "app",
        target_id: appId,
        metadata: JSON.stringify({
          path,
          total_size: Number(res.totalSize),
          truncated: res.truncated,
        }),
        created_at: new Date(),
      })
      .catch((err: unknown) => {
        log.warn(
          { err: (err as Error).message, userId: user.id, appId },
          "files.read.audit_failed"
        )
      })

    if (res.error && res.error.length > 0) {
      return c.json({ error: { code: "READ_FAILED", message: res.error } }, 404)
    }

    const content_b64 = Buffer.from(res.content).toString("base64")
    return c.json({
      path,
      content_b64,
      total_size: Number(res.totalSize),
      truncated: res.truncated,
      is_binary: res.isBinary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "agent error"
    log.error({ err, appId, path }, "files.read.failed")
    return c.json({ error: { code: "AGENT_ERROR", message } }, 502)
  }
})
