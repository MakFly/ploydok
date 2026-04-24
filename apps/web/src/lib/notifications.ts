// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useReducer } from "react"
import { apiFetch } from "./api"
import { useEventsConnected, useEventsSubscription } from "./events-provider"

// ---------------------------------------------------------------------------
// Types — duplicated from API contract intentionally.
// Future cleanup: promote to packages/shared when stable.
// ---------------------------------------------------------------------------

export type NotificationType =
  | "build.started"
  | "build.succeeded"
  | "build.failed"
  | "deploy.status_change"
  | "container.health"
  | "provider.sync.started"
  | "provider.sync.completed"
  | "provider.sync.failed"

export interface NotificationEvent {
  id: string
  type: NotificationType
  appId?: string
  buildId?: string
  message: string
  t: number
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// State + reducer
// ---------------------------------------------------------------------------

export interface NotificationsState {
  items: Array<NotificationEvent>
  /** Number of items strictly newer than `lastReadAt`. */
  unreadCount: number
  /** Server-persisted cursor — events with t <= lastReadAt are pre-read. */
  lastReadAt: number
  /** True once the cursor has been hydrated from the API at least once. */
  hydrated: boolean
  connected: boolean
}

const MAX_ITEMS = 20

type Action =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "push"; payload: NotificationEvent }
  | { type: "hydrate"; lastReadAt: number }
  | { type: "markAllRead"; at: number }
  | { type: "clear" }

const initialState: NotificationsState = {
  items: [],
  unreadCount: 0,
  lastReadAt: 0,
  hydrated: false,
  connected: false,
}

export function notificationsReducer(
  state: NotificationsState,
  action: Action,
): NotificationsState {
  switch (action.type) {
    case "connect":
      return { ...state, connected: true }

    case "disconnect":
      return { ...state, connected: false }

    case "hydrate": {
      // Recompute unreadCount against the server cursor.
      const unread = state.items.filter((it) => it.t > action.lastReadAt).length
      return {
        ...state,
        lastReadAt: action.lastReadAt,
        unreadCount: unread,
        hydrated: true,
      }
    }

    case "push": {
      // Dedup by event id — SSE replay on reconnect can re-deliver the same
      // event, and a future at-least-once bus would too.
      if (state.items.some((it) => it.id === action.payload.id)) return state
      const items = [action.payload, ...state.items].slice(0, MAX_ITEMS)
      const isUnread = action.payload.t > state.lastReadAt
      return {
        ...state,
        items,
        unreadCount: isUnread ? state.unreadCount + 1 : state.unreadCount,
      }
    }

    case "markAllRead":
      return { ...state, unreadCount: 0, lastReadAt: action.at }

    case "clear":
      return { ...state, items: [], unreadCount: 0 }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Hook — s'abonne au stream /events partagé via EventsProvider.
// Persiste le curseur "lu jusqu'à" côté serveur (POST /events/mark-read) pour
// que le compteur ne se ré-incrémente pas après refresh.
// ---------------------------------------------------------------------------

export function useNotifications(): {
  state: NotificationsState
  markAllRead: () => void
  clear: () => void
} {
  const [state, dispatch] = useReducer(notificationsReducer, initialState)
  const connected = useEventsConnected()

  // Reflect provider connection status into the notifications state.
  useEffect(() => {
    dispatch({ type: connected ? "connect" : "disconnect" })
  }, [connected])

  // Hydrate the read cursor from the server on mount. Without this, every
  // refresh resets unreadCount to 0 then the SSE replay re-bumps it.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch<{ lastReadAt: string | null }>("/events/read-state")
        if (cancelled) return
        const ms = res.lastReadAt ? new Date(res.lastReadAt).getTime() : 0
        dispatch({ type: "hydrate", lastReadAt: ms })
      } catch {
        // First boot or network blip — leave the optimistic 0 in place.
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Un abonnement par type — appels stables dans le même ordre à chaque render.
  const push = (payload: NotificationEvent) => dispatch({ type: "push", payload })
  useEventsSubscription<NotificationEvent>("build.started", push)
  useEventsSubscription<NotificationEvent>("build.succeeded", push)
  useEventsSubscription<NotificationEvent>("build.failed", push)
  useEventsSubscription<NotificationEvent>("deploy.status_change", push)
  useEventsSubscription<NotificationEvent>("container.health", push)
  // provider.sync.progress is intentionally NOT subscribed: it fires once per
  // page (potentially dozens per sync) and would flood the bell. The dialog
  // consumes it directly.
  useEventsSubscription<NotificationEvent>("provider.sync.started", push)
  useEventsSubscription<NotificationEvent>("provider.sync.completed", push)
  useEventsSubscription<NotificationEvent>("provider.sync.failed", push)

  const markAllRead = () => {
    const at = Date.now()
    dispatch({ type: "markAllRead", at })
    // Fire-and-forget: a failed POST falls back to client-only state,
    // which the next hydrate() will reconcile.
    void apiFetch("/events/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ at: new Date(at).toISOString() }),
    }).catch(() => {})
  }
  const clear = () => dispatch({ type: "clear" })

  return { state, markAllRead, clear }
}
