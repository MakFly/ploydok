// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useReducer } from "react"
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
  unreadCount: number
  connected: boolean
}

const MAX_ITEMS = 20

type Action =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "push"; payload: NotificationEvent }
  | { type: "markAllRead" }
  | { type: "clear" }

const initialState: NotificationsState = {
  items: [],
  unreadCount: 0,
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

    case "push": {
      // Dedup by event id — SSE replay on reconnect can re-deliver the same
      // event, and a future at-least-once bus would too.
      if (state.items.some((it) => it.id === action.payload.id)) return state
      const items = [action.payload, ...state.items].slice(0, MAX_ITEMS)
      return {
        ...state,
        items,
        unreadCount: state.unreadCount + 1,
      }
    }

    case "markAllRead":
      return { ...state, unreadCount: 0 }

    case "clear":
      return { ...state, items: [], unreadCount: 0 }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Hook — s'abonne au stream /events partagé via EventsProvider.
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

  // Un abonnement par type — appels stables dans le même ordre à chaque render.
  const push = (payload: NotificationEvent) => dispatch({ type: "push", payload })
  useEventsSubscription<NotificationEvent>("build.started", push)
  useEventsSubscription<NotificationEvent>("build.succeeded", push)
  useEventsSubscription<NotificationEvent>("build.failed", push)
  useEventsSubscription<NotificationEvent>("deploy.status_change", push)
  useEventsSubscription<NotificationEvent>("container.health", push)

  const markAllRead = () => dispatch({ type: "markAllRead" })
  const clear = () => dispatch({ type: "clear" })

  return { state, markAllRead, clear }
}
