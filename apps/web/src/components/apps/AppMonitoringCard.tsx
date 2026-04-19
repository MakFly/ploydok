// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useEventsSubscription } from "../../lib/events-provider"
import { useMonitoring } from "../../lib/monitoring"
import { ResourceCard } from "../monitoring/ResourceCard"
import type { AppStatus, ContainerSnapshot } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContainerHealthPayload {
  appId?: string
  container?: ContainerSnapshot
  t?: number
}

// ---------------------------------------------------------------------------
// Ring buffer helpers
// ---------------------------------------------------------------------------

const HISTORY_LEN = 60
const STATUS_PRIORITY: Record<ContainerSnapshot["status"], number> = {
  running: 4,
  unhealthy: 3,
  starting: 2,
  stopped: 1,
  unknown: 0,
}

function pushToHistory(history: Array<number>, value: number): Array<number> {
  return [...history, value].slice(-HISTORY_LEN)
}

export function selectAppSnapshot(
  containers: Array<ContainerSnapshot>,
  appId: string,
): ContainerSnapshot | null {
  let selected: ContainerSnapshot | null = null

  for (const container of containers) {
    if (container.app_id !== appId) continue
    if (container.kind && container.kind !== "app") continue
    if (!selected) {
      selected = container
      continue
    }

    const statusDiff =
      STATUS_PRIORITY[container.status] - STATUS_PRIORITY[selected.status]
    if (statusDiff > 0) {
      selected = container
      continue
    }
    if (statusDiff === 0 && container.last_seen_ms > selected.last_seen_ms) {
      selected = container
    }
  }

  return selected
}

// ---------------------------------------------------------------------------
// Loading skeleton — mirrors ResourceCard's shape (header + stats + mem bar + charts)
// ---------------------------------------------------------------------------

function MonitoringSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex animate-pulse flex-col gap-3 rounded-lg border border-border bg-card p-4"
      aria-busy="true"
      aria-label="Loading monitoring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-4 rounded bg-muted" />
          <div className="min-w-0 space-y-1.5">
            <div className="h-3.5 w-32 rounded bg-muted" />
            <div className="h-2.5 w-24 rounded bg-muted" />
          </div>
        </div>
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
      </div>
      <div className="space-y-1.5">
        <div className="h-2.5 w-full rounded bg-muted" />
        <div className="h-1.5 w-full rounded-full bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="h-20 rounded-md bg-muted" />
        <div className="h-20 rounded-md bg-muted" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Not Running placeholder
// ---------------------------------------------------------------------------

function NotRunning(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-medium text-foreground">Resource monitoring</h3>
      <div className="flex items-center gap-2 py-4">
        <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Not running</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Start or deploy the app to see live CPU and memory usage.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Restarting overlay
// ---------------------------------------------------------------------------

function RestartingOverlay(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-foreground">
      <span
        className="inline-block size-2 animate-pulse rounded-full bg-primary"
        aria-hidden="true"
      />
      Restarting…
    </div>
  )
}

// ---------------------------------------------------------------------------
// AppMonitoringCard
//
// Subscribes to `container.health` SSE events and filters by appId.
// Feeds the most recent snapshot into ResourceCard along with rolling
// history buffers for CPU and memory sparklines.
// When appStatus is "restarting", shows a banner but preserves the last
// known snapshot values so the card does not flash back to NotRunning.
// ---------------------------------------------------------------------------

interface AppMonitoringCardProps {
  appId: string
  appStatus?: AppStatus
}

export function AppMonitoringCard({
  appId,
  appStatus,
}: AppMonitoringCardProps): React.JSX.Element {
  const { data: monitoring, isLoading: monitoringLoading } = useMonitoring()
  const [snapshot, setSnapshot] = React.useState<ContainerSnapshot | null>(null)
  const [cpuHistory, setCpuHistory] = React.useState<Array<number>>([])
  const [memHistory, setMemHistory] = React.useState<Array<number>>([])
  const overviewSnapshot = selectAppSnapshot(monitoring?.containers ?? [], appId)

  // Wrapped in useCallback so the reference is stable across renders,
  // keeping useEventsSubscription's dependency array predictable.
  const handleHealth = React.useCallback(
    (payload: ContainerHealthPayload) => {
      if (payload.appId !== appId) return
      if (!payload.container) return

      const snap = payload.container
      setSnapshot(snap)
      setCpuHistory((prev) => pushToHistory(prev, snap.cpu_pct))
      setMemHistory((prev) => pushToHistory(prev, snap.mem_bytes))
    },
    [appId],
  )

  useEventsSubscription<ContainerHealthPayload>("container.health", handleHealth)

  React.useEffect(() => {
    if (!overviewSnapshot) return

    setSnapshot((prev) => {
      if (
        prev?.id === overviewSnapshot.id &&
        prev.last_seen_ms === overviewSnapshot.last_seen_ms
      ) {
        return prev
      }
      return overviewSnapshot
    })
    setCpuHistory((prev) =>
      prev.at(-1) === overviewSnapshot.cpu_pct
        ? prev
        : pushToHistory(prev, overviewSnapshot.cpu_pct),
    )
    setMemHistory((prev) =>
      prev.at(-1) === overviewSnapshot.mem_bytes
        ? prev
        : pushToHistory(prev, overviewSnapshot.mem_bytes),
    )
  }, [overviewSnapshot])

  // Reset state only when the watched app changes, not when status changes.
  // This preserves the last metrics during a restarting transition.
  React.useEffect(() => {
    setSnapshot(null)
    setCpuHistory([])
    setMemHistory([])
  }, [appId])

  const isRestarting = appStatus === "restarting"

  if (!snapshot) {
    if (isRestarting) {
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground">
            Resource monitoring
          </h3>
          <RestartingOverlay />
        </div>
      )
    }
    if (monitoringLoading) return <MonitoringSkeleton />
    return <NotRunning />
  }

  return (
    <div className="relative">
      {isRestarting && (
        <div className="absolute inset-x-0 top-0 z-10 px-1 pt-1">
          <RestartingOverlay />
        </div>
      )}
      <ResourceCard
        snapshot={snapshot}
        cpuHistory={cpuHistory}
        memHistory={memHistory}
      />
    </div>
  )
}
