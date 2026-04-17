// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useAppEvents } from "../../lib/hooks/use-app-events"
import type { AppEvent, AppEventType } from "../../lib/hooks/use-app-events"

// ---------------------------------------------------------------------------
// Helpers — pure functions for testability
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable label for an event type.
 */
export function formatEventType(type: AppEventType): string {
  switch (type) {
    case "build.started":
      return "Build started"
    case "build.succeeded":
      return "Build succeeded"
    case "build.failed":
      return "Build failed"
    case "deploy.status_change":
      return "Deployment status changed"
    case "container.health":
      return "Container health update"
    default:
      return type
  }
}

/**
 * Returns an icon character for an event type.
 * Intentionally a string (emoji-free) to avoid encoding issues.
 */
export function eventIcon(type: AppEventType): string {
  switch (type) {
    case "build.started":
      return "↑"
    case "build.succeeded":
      return "✓"
    case "build.failed":
      return "✗"
    case "deploy.status_change":
      return "⇄"
    case "container.health":
      return "♥"
    default:
      return "·"
  }
}

/**
 * Format a Unix timestamp (ms) into a relative string using Intl.RelativeTimeFormat.
 * Falls back to an absolute time string if the browser doesn't support it.
 */
export function formatRelativeTime(timestampMs: number, nowMs = Date.now()): string {
  const diffMs = timestampMs - nowMs
  const diffS = Math.round(diffMs / 1000)
  const diffM = Math.round(diffMs / 60_000)
  const diffH = Math.round(diffMs / 3_600_000)
  const diffD = Math.round(diffMs / 86_400_000)

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

  if (Math.abs(diffS) < 60) return rtf.format(diffS, "second")
  if (Math.abs(diffM) < 60) return rtf.format(diffM, "minute")
  if (Math.abs(diffH) < 24) return rtf.format(diffH, "hour")
  return rtf.format(diffD, "day")
}

// ---------------------------------------------------------------------------
// ActivityItem
// ---------------------------------------------------------------------------

interface ActivityItemProps {
  event: AppEvent
}

function ActivityItem({ event }: ActivityItemProps): React.JSX.Element {
  const icon = eventIcon(event.type)
  const label = formatEventType(event.type)
  const time = formatRelativeTime(event.timestamp)

  // Extract optional message from event data
  const message =
    typeof event.data["message"] === "string" ? event.data["message"] : null

  return (
    <li className="flex items-start gap-2.5 py-2">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-snug">{label}</p>
        {message && (
          <p className="truncate text-xs text-muted-foreground" title={message}>
            {message}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
        {time}
      </span>
    </li>
  )
}

// ---------------------------------------------------------------------------
// ActivityFeed
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  appId: string
  /** Maximum number of events to display. Defaults to 10. */
  limit?: number
}

export function ActivityFeed({
  appId,
  limit = 10,
}: ActivityFeedProps): React.JSX.Element {
  const events = useAppEvents(appId, limit)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Activity
      </p>

      {events.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No recent activity.
        </p>
      ) : (
        <ul
          className="max-h-64 overflow-y-auto divide-y divide-border"
          aria-label="Recent app events"
        >
          {events.map((event) => (
            <ActivityItem key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  )
}
