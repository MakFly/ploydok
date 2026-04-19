// SPDX-License-Identifier: AGPL-3.0-only
//
// WebSocket log streaming — M3.2
//
// Endpoints:
//   GET /ws/apps/:id/build/:buildId  — stream build logs (channel: build:{buildId})
//   GET /ws/apps/:id/logs            — stream runtime logs (channel: runtime:{appId})
//
// Auth: cookie ploydok_access verified before upgrade.
// Ownership: user must own the project that contains the app.
//
// Message format (server → client): { t: number, line: string }
// Heartbeat: server pings every 30 s; client must respond with pong or
//            the server closes the connection after 2 missed heartbeats.
//
// Implementation note:
//   Hono does not expose a built-in WebSocket adapter for Bun by default.
//   We use `createBunWebSocket` from `hono/bun` which injects a `upgradeWebSocket`
//   middleware that calls `server.upgrade()` under the hood.
//   The caller (index.ts) must pass the `websocket` handler from this module
//   to `Bun.serve({ ..., websocket })`.

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { eq } from "drizzle-orm";
import { createDb, apps, projects } from "@ploydok/db";
import { verifyAccessToken, ACCESS_COOKIE } from "../auth/jwt";
import { logBus } from "../worker/log-bus";
import { env } from "../env";
import type { LogEntry } from "../worker/log-bus";
import { getSharedAgent } from "../debug/singletons";
import { resolveRuntimeContainer } from "../runtime-containers";

// ---------------------------------------------------------------------------
// BunWebSocket adapter — the `websocket` object must be forwarded to Bun.serve.
// ---------------------------------------------------------------------------

export const { upgradeWebSocket, websocket: wsHandler } = createBunWebSocket();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PINGS = 2;
const REPLAY_LIMIT = 1_000;

// ---------------------------------------------------------------------------
// Auth helper — extracted from request context before upgrade.
// ---------------------------------------------------------------------------

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Verifies the access cookie and returns the user id.
 * Returns null if the token is missing or invalid.
 */
async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookies = parseCookies(cookieHeader);
  const token = cookies[ACCESS_COOKIE];
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(token);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ownership check
// ---------------------------------------------------------------------------

const db = createDb(env.DATABASE_URL);

/**
 * Returns true if `userId` owns the project that contains `appId`.
 */
async function userOwnsApp(appId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(apps.id, appId))
    .limit(1);

  if (!rows[0]) return false;

  const projectRows = await db
    .select({ owner_id: projects.owner_id })
    .from(projects)
    .innerJoin(apps, eq(apps.project_id, projects.id))
    .where(eq(apps.id, appId))
    .limit(1);

  return projectRows[0]?.owner_id === userId;
}

// ---------------------------------------------------------------------------
// Generic log stream handler factory
// ---------------------------------------------------------------------------

function createLogStreamHandler(getChannelAndAuth: (c: Parameters<typeof upgradeWebSocket>[0]) => Promise<{ channel: string; userId: string } | null>) {
  return upgradeWebSocket((c) => {
    // Per-connection mutable state.
    let unsubscribe: (() => void) | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let missedPings = 0;
    let channel = "";

    return {
      async onOpen(_evt, ws) {
        // 1. Authenticate + authorize.
        const result = await getChannelAndAuth(c);
        if (!result) {
          ws.close(4001, "unauthorized");
          return;
        }
        channel = result.channel;

        // 2. Replay buffered history.
        const history = logBus.replay(channel, REPLAY_LIMIT);
        for (const entry of history) {
          ws.send(JSON.stringify(entry));
        }

        // 3. Subscribe to live entries.
        unsubscribe = logBus.subscribe(channel, (entry: LogEntry) => {
          ws.send(JSON.stringify(entry));
        });

        // 4. Start heartbeat — sends a ping JSON message every 30 s.
        //    Bun's WS API exposes ws.send for data; actual ping frames are
        //    handled at transport level.  We track pong responses via onMessage.
        pingTimer = setInterval(() => {
          missedPings++;
          if (missedPings > MAX_MISSED_PINGS) {
            ws.close(1001, "heartbeat timeout");
            return;
          }
          ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        }, HEARTBEAT_INTERVAL_MS);
      },

      onMessage(msg, _ws) {
        // Client responded to a ping — reset missed counter.
        try {
          const data = JSON.parse(typeof msg.data === "string" ? msg.data : String(msg.data)) as unknown;
          if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "pong") {
            missedPings = 0;
          }
        } catch {
          // Non-JSON messages are silently ignored.
        }
      },

      onClose() {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      },
    };
  });
}

function createRuntimeLogStreamHandler() {
  return upgradeWebSocket((c) => {
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let missedPings = 0;
    let closed = false
    let stopStreaming: (() => void) | null = null

    return {
      async onOpen(_evt, ws) {
        const appId = c.req.param("id") ?? ""
        if (!appId) {
          ws.close(4000, "missing app id")
          return
        }

        const userId = await getUserIdFromRequest(c.req.raw)
        if (!userId) {
          ws.close(4001, "unauthorized")
          return
        }

        const ownedRows = await db
          .select({ id: apps.id, container_id: apps.container_id })
          .from(apps)
          .innerJoin(projects, eq(apps.project_id, projects.id))
          .where(eq(apps.id, appId))
          .limit(1)

        const app = ownedRows[0]
        const ownsApp = await userOwnsApp(appId, userId)
        if (!app || !ownsApp) {
          ws.close(4001, "unauthorized")
          return
        }

        const agent = getSharedAgent()
        const container = await resolveRuntimeContainer(agent, {
          appId,
          preferredContainerRef: app.container_id,
        })

        if (!container) {
          ws.send(JSON.stringify({ type: "runtime.missing", t: Date.now() }))
          ws.close(1000, "no runtime container")
          return
        }

        pingTimer = setInterval(() => {
          missedPings++
          if (missedPings > MAX_MISSED_PINGS) {
            ws.close(1001, "heartbeat timeout")
            return
          }
          ws.send(JSON.stringify({ type: "ping", t: Date.now() }))
        }, HEARTBEAT_INTERVAL_MS)

        const iterator = agent.containerLogs({
          containerId: container.id,
          follow: true,
          sinceUnix: 0,
          tail: REPLAY_LIMIT,
        })[Symbol.asyncIterator]()

        stopStreaming = () => {
          void iterator.return?.()
        }

        void (async () => {
          try {
            for (;;) {
              const next = await iterator.next()
              if (next.done || closed) break
              const line = next.value
              ws.send(
                JSON.stringify({
                  t: Date.parse(line.timestamp) || Date.now(),
                  line: line.line,
                  stream:
                    line.stream === "stdout" || line.stream === "stderr"
                      ? line.stream
                      : undefined,
                }),
              )
            }
          } catch {
            if (!closed) {
              ws.close(1011, "runtime log stream failed")
            }
          }
        })()
      },

      onMessage(msg, _ws) {
        try {
          const data = JSON.parse(typeof msg.data === "string" ? msg.data : String(msg.data)) as unknown;
          if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "pong") {
            missedPings = 0;
          }
        } catch {
          // Non-JSON messages are silently ignored.
        }
      },

      onClose() {
        closed = true
        stopStreaming?.()
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const wsRouter = new Hono();

// GET /ws/apps/:id/build/:buildId — build log stream
wsRouter.get(
  "/apps/:id/build/:buildId",
  createLogStreamHandler(async (c) => {
    const appId = c.req.param("id") ?? "";
    const buildId = c.req.param("buildId") ?? "";

    if (!appId || !buildId) return null;

    const userId = await getUserIdFromRequest(c.req.raw);
    if (!userId) return null;

    const owned = await userOwnsApp(appId, userId);
    if (!owned) return null;

    return { channel: `build:${buildId}`, userId };
  }),
);

// GET /ws/apps/:id/logs — runtime log stream
wsRouter.get(
  "/apps/:id/logs",
  createRuntimeLogStreamHandler(),
);
