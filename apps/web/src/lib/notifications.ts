// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useReducer, useRef } from "react"

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
      const items = [action.payload, ...state.items].slice(0, MAX_ITEMS)
      return {
        ...state,
        items,
        unreadCount: state.connected ? state.unreadCount + 1 : state.unreadCount,
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
// SSE URL — mirrors API_BASE from api.ts
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000"

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications(): {
  state: NotificationsState
  markAllRead: () => void
  clear: () => void
} {
  const [state, dispatch] = useReducer(notificationsReducer, initialState)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    // Gate: EventSource does not exist server-side (TanStack Start SSR).
    if (typeof window === "undefined") return

    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true })
    esRef.current = es

    es.onopen = () => {
      dispatch({ type: "connect" })
    }

    es.onerror = () => {
      // Do not close: native EventSource retry handles reconnection.
      dispatch({ type: "disconnect" })
    }

    es.onmessage = (ev: MessageEvent<string>) => {
      // Generic "message" events (no event: field) — ignored for now.
      void ev
    }

    // Typed named events — all NotificationType values plus ping.
    const knownTypes: Array<NotificationType | "ping"> = [
      "ping",
      "build.started",
      "build.succeeded",
      "build.failed",
      "deploy.status_change",
      "container.health",
    ]

    function handleNamedEvent(ev: Event): void {
      const msgEvent = ev as MessageEvent<string>
      if (msgEvent.type === "ping") return

      let parsed: unknown
      try {
        parsed = JSON.parse(msgEvent.data)
      } catch {
        return
      }

      const notification = parsed as NotificationEvent
      dispatch({ type: "push", payload: notification })
    }

    for (const eventType of knownTypes) {
      es.addEventListener(eventType, handleNamedEvent)
    }

    return () => {
      for (const eventType of knownTypes) {
        es.removeEventListener(eventType, handleNamedEvent)
      }
      es.close()
      esRef.current = null
    }
  }, [])

  const markAllRead = () => dispatch({ type: "markAllRead" })
  const clear = () => dispatch({ type: "clear" })

  return { state, markAllRead, clear }
}
