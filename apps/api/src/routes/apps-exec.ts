// SPDX-License-Identifier: AGPL-3.0-only
//
// WebSocket shell exec — proxy WS ↔ gRPC bidi ContainerExec
//
// Endpoint:
//   GET /ws/apps/:id/exec?cols=80&rows=24
//
// Auth   : cookie ploydok_access vérifié AVANT upgrade (close 4001 sinon).
// Ownership : userOwnsApp() vérifié AVANT upgrade (close 4001 sinon).
// container_id : lu depuis DB (jamais depuis la query string).
// Shell  : /bin/sh (MVP — le param `shell` est ignoré).
//
// Frames client → server :
//   Binary                         = stdin brut
//   JSON  { type:"resize", cols, rows }
//
// Frames server → client :
//   Binary                         = stdout (tty mode — inclut stderr)
//   JSON  { type:"ready" }
//   JSON  { type:"exit",  code:N }
//   JSON  { type:"error", message:"..." }
//
// Close codes :
//   4001  unauthorized
//   4004  app not found / no container_id
//   1000  exit normal
//   1001  idle timeout / absolute timeout
//   1011  erreur interne

import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import { eq, and, isNotNull } from "drizzle-orm"
import { createDb, apps, projects, memberships } from "@ploydok/db"
import { verifyAccessToken, ACCESS_COOKIE } from "../auth/jwt"
import { env } from "../env"
import { getSharedAgent } from "../debug/singletons"
import { childLogger } from "../logger"
import type { ExecFrame } from "@ploydok/agent-proto"

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = childLogger("exec")

// ---------------------------------------------------------------------------
// BunWebSocket adapter
// ---------------------------------------------------------------------------

export const { upgradeWebSocket, websocket: wsExecHandler } =
  createBunWebSocket()

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 600_000 // 10 min
const ABSOLUTE_TIMEOUT_MS = 3_600_000 // 1 h
const SHELL = "/bin/sh"

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const db = createDb(env.DATABASE_URL)

// ---------------------------------------------------------------------------
// Auth helpers (extracted from ws.ts — duplicated per scope ownership rule)
// ---------------------------------------------------------------------------

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  }
  return out
}

/**
 * Verifies the access cookie and returns the user id.
 * Returns null if the token is missing or invalid.
 */
export async function getUserIdFromRequest(
  req: Request
): Promise<string | null> {
  const cookieHeader = req.headers.get("cookie") ?? ""
  const cookies = parseCookies(cookieHeader)
  const token = cookies[ACCESS_COOKIE]
  if (!token) return null
  try {
    const payload = await verifyAccessToken(token)
    return payload.sub ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Ownership check
// ---------------------------------------------------------------------------

/**
 * Returns true if `userId` is an owner (role='owner') of the project that contains `appId`.
 * Shell access is owner-only.
 */
export async function userOwnsApp(
  appId: string,
  userId: string
): Promise<boolean> {
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(apps, eq(apps.project_id, projects.id))
    .innerJoin(
      memberships,
      and(
        eq(memberships.org_id, projects.id),
        eq(memberships.user_id, userId),
        eq(memberships.role, "owner"),
        isNotNull(memberships.accepted_at)
      )
    )
    .where(eq(apps.id, appId))
    .limit(1)

  return projectRows.length > 0
}

// ---------------------------------------------------------------------------
// Build the initial ExecStart frame
// ---------------------------------------------------------------------------

/**
 * Constructs the ExecStart frame to send as the first gRPC message.
 * Exported for unit testing.
 */
export function buildStartFrame(
  containerId: string,
  cols: number,
  rows: number
): ExecFrame {
  return {
    start: {
      containerId,
      cmd: [SHELL],
      tty: true,
      cols,
      rows,
      user: "",
    },
  }
}

// ---------------------------------------------------------------------------
// Exec WS handler
// ---------------------------------------------------------------------------

export const wsExecRouter = new Hono()

wsExecRouter.get(
  "/apps/:id/exec",
  upgradeWebSocket((c) => {
    const appId = c.req.param("id") ?? ""
    const cols = Math.max(1, parseInt(c.req.query("cols") ?? "80", 10) || 80)
    const rows = Math.max(1, parseInt(c.req.query("rows") ?? "24", 10) || 24)

    // Per-connection state
    let closed = false
    let execSession: ReturnType<
      ReturnType<typeof getSharedAgent>["containerExec"]
    > | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let absoluteTimer: ReturnType<typeof setTimeout> | null = null
    let startMs = 0
    let sessionUserId = ""
    let sessionContainerId = ""

    function resetIdle() {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        log.info(
          { userId: sessionUserId, appId, containerId: sessionContainerId },
          "exec.idle_timeout"
        )
        closeSession(null, 1001, "idle timeout")
      }, IDLE_TIMEOUT_MS)
    }

    function closeSession(
      ws: { close(code: number, reason?: string): void } | null,
      code: number,
      reason: string,
      exitCode?: number
    ) {
      if (closed) return
      closed = true

      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      if (absoluteTimer) {
        clearTimeout(absoluteTimer)
        absoluteTimer = null
      }

      if (execSession) {
        try {
          execSession.close()
        } catch {
          /* ignore */
        }
        execSession = null
      }

      if (startMs > 0) {
        log.info(
          {
            userId: sessionUserId,
            appId,
            containerId: sessionContainerId,
            durationMs: Date.now() - startMs,
            exitCode: exitCode ?? null,
          },
          "exec.end"
        )
      }

      if (ws) {
        ws.close(code, reason)
      }
    }

    return {
      async onOpen(_evt, ws) {
        if (!appId) {
          ws.close(4004, "missing app id")
          return
        }

        // 1. Authenticate
        const userId = await getUserIdFromRequest(c.req.raw)
        if (!userId) {
          ws.close(4001, "unauthorized")
          return
        }
        sessionUserId = userId

        // 2. Ownership check
        const owned = await userOwnsApp(appId, userId)
        if (!owned) {
          ws.close(4001, "unauthorized")
          return
        }

        // 3. Look up container_id from DB — never from query string
        const appRows = await db
          .select({ container_id: apps.container_id })
          .from(apps)
          .where(eq(apps.id, appId))
          .limit(1)

        const containerId = appRows[0]?.container_id
        if (!containerId) {
          ws.close(4004, "no container_id for app")
          return
        }
        sessionContainerId = containerId

        // 4. Audit log
        startMs = Date.now()
        log.info({ userId, appId, containerId }, "exec.start")

        // 5. Open gRPC bidi stream
        const agent = getSharedAgent()
        execSession = agent.containerExec()

        // 6. Set timers
        resetIdle()
        absoluteTimer = setTimeout(() => {
          log.info({ userId, appId, containerId }, "exec.absolute_timeout")
          closeSession(ws, 1001, "session timeout")
        }, ABSOLUTE_TIMEOUT_MS)

        // 7. Start frame
        execSession.send(buildStartFrame(containerId, cols, rows))

        // 8. Pump gRPC frames → WS (async loop)
        void (async () => {
          try {
            for await (const frame of execSession!.events) {
              if (closed) break
              resetIdle()

              if (frame.ready) {
                ws.send(JSON.stringify({ type: "ready" }))
              } else if (frame.stdout && frame.stdout.byteLength > 0) {
                // Send raw binary — xterm.js reads it directly.
                // Cast: proto generates Uint8Array<ArrayBufferLike>, Bun WS expects Uint8Array<ArrayBuffer>.
                ws.send(frame.stdout as Uint8Array<ArrayBuffer>)
              } else if (frame.stderr && frame.stderr.byteLength > 0) {
                // In TTY mode this rarely fires; forward as binary anyway.
                ws.send(frame.stderr as Uint8Array<ArrayBuffer>)
              } else if (frame.exit) {
                const code = frame.exit.code
                ws.send(JSON.stringify({ type: "exit", code }))
                closeSession(ws, 1000, "exit", code)
                return
              }
            }
          } catch (err) {
            if (!closed) {
              const msg =
                err instanceof Error ? err.message : "gRPC stream error"
              log.error({ err, userId, appId, containerId }, "exec.grpc_error")
              try {
                ws.send(JSON.stringify({ type: "error", message: msg }))
              } catch {
                /* ignore */
              }
              closeSession(ws, 1011, "internal error")
            }
          }
        })()
      },

      onMessage(msg, ws) {
        if (closed || !execSession) return
        resetIdle()

        const data = msg.data

        // Binary → stdin
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          const bytes =
            data instanceof ArrayBuffer ? new Uint8Array(data) : data
          execSession.send({ stdin: bytes })
          return
        }

        // Text → JSON control frame
        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data) as unknown
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              (parsed as { type?: unknown }).type === "resize"
            ) {
              const { cols: c, rows: r } = parsed as {
                cols?: unknown
                rows?: unknown
              }
              if (typeof c === "number" && typeof r === "number") {
                execSession.send({
                  resize: { cols: Math.max(1, c), rows: Math.max(1, r) },
                })
              }
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      },

      onClose() {
        closeSession(null, 1000, "client closed")
      },
    }
  })
)
