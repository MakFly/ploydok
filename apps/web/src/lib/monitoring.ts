// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ContainerSnapshotSchema } from "@ploydok/shared"
import { apiFetch, criticalRetryDelay, shouldRetryCriticalQuery } from "./api"
import { useBackendUnavailable } from "./backend-status"
import { useEventsSubscription } from "./events-provider"
import type { ContainerSnapshot, MonitoringOverview } from "@ploydok/shared"
import type { ApiError } from "./api"

interface ContainerHealthNotification {
  appId?: string
  data?: Record<string, unknown>
}

export function getContainerHealthSnapshot(
  event: ContainerHealthNotification
): ContainerSnapshot | null {
  const parsed = ContainerSnapshotSchema.safeParse(event.data?.["container"])
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// useMonitoring — GET /monitoring/overview, live-patched via SSE
//
// Live status (healthy/unhealthy/restarting) flows from the agent through the
// `container.health` SSE event. We patch the cached overview on every event
// so consumers (apps grid, dashboard, /monitoring) reflect runtime state in
// real time without a 5 s poll. A 30 s fallback refetch is kept in case the
// stream silently drops between reconnects.
// ---------------------------------------------------------------------------

export function useMonitoring(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true
  const backendUnavailable = useBackendUnavailable()
  const qc = useQueryClient()

  useEventsSubscription<ContainerHealthNotification>(
    "container.health",
    (monEv) => {
      const snap = getContainerHealthSnapshot(monEv)
      if (!snap) return
      qc.setQueryData<MonitoringOverview>(["monitoring", "overview"], (old) => {
        if (!old) return old
        const idx = old.containers.findIndex((c) => c.id === snap.id)
        if (idx === -1) {
          return { ...old, containers: [...old.containers, snap] }
        }
        const next = old.containers.slice()
        next[idx] = snap
        return { ...old, containers: next }
      })
    },
    enabled
  )

  return useQuery<MonitoringOverview, ApiError>({
    queryKey: ["monitoring", "overview"],
    queryFn: () => apiFetch<MonitoringOverview>("/monitoring/overview"),
    refetchInterval: backendUnavailable.active ? false : 30_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    enabled: enabled && !backendUnavailable.active,
    meta: { critical: true },
  })
}

// ---------------------------------------------------------------------------
// usePingContainer — POST /monitoring/ping/:id
// ---------------------------------------------------------------------------

export interface PingResult {
  ok: boolean
  statusCode: number
  latencyMs: number
  error: string
}

export interface PingArgs {
  id: string
  path: string
  port: number
  timeoutMs?: number
}

export function usePingContainer() {
  return useMutation({
    mutationFn: (args: PingArgs) =>
      apiFetch<PingResult>(`/monitoring/ping/${encodeURIComponent(args.id)}`, {
        method: "POST",
        body: {
          path: args.path,
          port: args.port,
          timeoutMs: args.timeoutMs,
        },
      }),
  })
}

// ---------------------------------------------------------------------------
// useMonitoringEvents — s'abonne au stream /events partagé via EventsProvider.
// ---------------------------------------------------------------------------

export function useMonitoringEvents(
  onChange: (container: ContainerSnapshot) => void
): void {
  useEventsSubscription<ContainerHealthNotification>(
    "container.health",
    (monEv) => {
      const snap = getContainerHealthSnapshot(monEv)
      if (snap) onChange(snap)
    }
  )
}
