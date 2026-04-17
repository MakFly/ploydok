// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useEventsSubscription } from "../events-provider"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppEventType =
  | "build.started"
  | "build.succeeded"
  | "build.failed"
  | "deploy.status_change"
  | "container.health"

export interface AppEvent {
  id: string
  type: AppEventType
  timestamp: number
  data: Record<string, unknown>
}

// SSE payloads — partial shapes sufficient for display purposes.
interface SsePayloadWithApp {
  appId?: string
  buildId?: string
  message?: string
  t?: number
  id?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Pure helpers (extracted for testability)
// ---------------------------------------------------------------------------

/**
 * Given a raw SSE payload and its event type, determine if the event belongs
 * to the target app. All supported event types include an `appId` field.
 */
export function eventBelongsToApp(
  _type: AppEventType,
  payload: SsePayloadWithApp,
  appId: string,
): boolean {
  return payload.appId === appId
}

/**
 * Build an AppEvent from a raw SSE payload.
 * Falls back to a generated id when the payload has none.
 */
export function buildAppEvent(
  type: AppEventType,
  payload: SsePayloadWithApp,
): AppEvent {
  const id =
    typeof payload.id === "string"
      ? payload.id
      : `${type}-${payload.buildId ?? ""}-${payload.t ?? Date.now()}`
  return {
    id,
    type,
    timestamp: typeof payload.t === "number" ? payload.t : Date.now(),
    data: payload as Record<string, unknown>,
  }
}

/**
 * Prepend an event to the list, dedup by id, and cap to `limit`.
 */
export function prependEvent(
  list: Array<AppEvent>,
  event: AppEvent,
  limit: number,
): Array<AppEvent> {
  if (list.some((e) => e.id === event.id)) return list
  return [event, ...list].slice(0, limit)
}

// ---------------------------------------------------------------------------
// Supported event types consumed by this hook
// ---------------------------------------------------------------------------

const SUPPORTED_TYPES: Array<AppEventType> = [
  "build.started",
  "build.succeeded",
  "build.failed",
  "deploy.status_change",
  "container.health",
]

// ---------------------------------------------------------------------------
// useAppEvents
//
// Subscribes to the shared SSE stream and returns the last `limit` events
// that concern the given `appId`. Events from other apps are silently dropped.
// ---------------------------------------------------------------------------

export function useAppEvents(appId: string, limit = 10): Array<AppEvent> {
  const [events, setEvents] = React.useState<Array<AppEvent>>([])

  const handleEvent = React.useCallback(
    (type: AppEventType) => (payload: unknown) => {
      const p = payload as SsePayloadWithApp
      if (!eventBelongsToApp(type, p, appId)) return
      const event = buildAppEvent(type, p)
      setEvents((prev) => prependEvent(prev, event, limit))
    },
    [appId, limit],
  )

  useEventsSubscription<SsePayloadWithApp>("build.started", handleEvent("build.started"))
  useEventsSubscription<SsePayloadWithApp>("build.succeeded", handleEvent("build.succeeded"))
  useEventsSubscription<SsePayloadWithApp>("build.failed", handleEvent("build.failed"))
  useEventsSubscription<SsePayloadWithApp>("deploy.status_change", handleEvent("deploy.status_change"))
  useEventsSubscription<SsePayloadWithApp>("container.health", handleEvent("container.health"))

  // Reset when appId changes
  React.useEffect(() => {
    setEvents([])
  }, [appId])

  return events
}

// Re-export the list of types for consumers that need to introspect.
export { SUPPORTED_TYPES }
