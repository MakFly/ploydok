// SPDX-License-Identifier: AGPL-3.0-only
//
// SSE notification stream — GET /events
//
// Auth: requireAuth(db) is mounted in app.ts before this router.
// The user is available via c.get("user").
//
// Stream lifecycle:
//   1. Replay last 20 events for channel user:{userId}.
//   2. Subscribe to live events on the same channel.
//   3. Send a heartbeat ping every 30 s.
//   4. On abort: clear heartbeat + unsubscribe.

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { eventBus } from "../worker/event-bus"
import type { AuthUser } from "../auth/middleware"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000
const REPLAY_LIMIT = 20

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eventsRouter = new Hono<{ Variables: { user?: AuthUser } }>()

// GET / — SSE stream for the authenticated user
eventsRouter.get("/", (c) => {
  const user = c.get("user") as AuthUser | undefined

  if (!user) {
    return c.json(
      { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
      401,
    )
  }

  const channel = `user:${user.id}`

  return streamSSE(c, async (stream) => {
    // 1. Replay buffered history.
    const history = eventBus.replay(channel, REPLAY_LIMIT)
    for (const event of history) {
      await stream.writeSSE({
        data: JSON.stringify(event),
        event: event.type,
        id: event.id,
      })
    }

    // 2. Subscribe to live events.
    const unsubscribe = eventBus.subscribe(channel, (event) => {
      stream
        .writeSSE({
          data: JSON.stringify(event),
          event: event.type,
          id: event.id,
        })
        .catch(() => {
          // Stream may have closed — subscriber will be cleaned up via onAbort.
        })
    })

    // 3. Heartbeat every 30 s.
    const hb = setInterval(() => {
      stream
        .writeSSE({ event: "ping", data: String(Date.now()) })
        .catch(() => {})
    }, HEARTBEAT_INTERVAL_MS)

    // 4. Cleanup on disconnect — also resolves the open promise so the handler returns.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(hb)
        unsubscribe()
        resolve()
      })
    })
  })
})
