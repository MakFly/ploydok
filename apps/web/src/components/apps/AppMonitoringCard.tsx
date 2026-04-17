// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useEventsSubscription } from "../../lib/events-provider"
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

function pushToHistory(history: Array<number>, value: number): Array<number> {
  return [...history, value].slice(-HISTORY_LEN)
}

// ---------------------------------------------------------------------------
// Not Running placeholder
// ---------------------------------------------------------------------------

function NotRunning(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-[1.4rem] border border-border/70 bg-white/90 p-5 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Resource monitoring
      </p>
      <div className="flex items-center gap-2 py-4">
        <span className="inline-block size-2 rounded-full bg-slate-300" />
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
    <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2 text-sm text-blue-700">
      <span className="inline-block size-2 rounded-full bg-blue-400 animate-pulse" aria-hidden="true" />
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
  const [snapshot, setSnapshot] = React.useState<ContainerSnapshot | null>(null)
  const [cpuHistory, setCpuHistory] = React.useState<Array<number>>([])
  const [memHistory, setMemHistory] = React.useState<Array<number>>([])

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
        <div className="flex flex-col gap-2 rounded-[1.4rem] border border-border/70 bg-white/90 p-5 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Resource monitoring
          </p>
          <RestartingOverlay />
        </div>
      )
    }
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
