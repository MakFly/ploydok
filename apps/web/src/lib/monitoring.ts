// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery } from "@tanstack/react-query"

import {
  ApiError,
  apiFetch,
  apiFetchAllowErrorBody,
  criticalRetryDelay,
  shouldRetryCriticalQuery,
} from "./api"
import { useBackendUnavailable } from "./backend-status"
import { useEventsSubscription } from "./events-provider"
import type {
  ContainerSnapshot,
  MonitoringEvent,
  MonitoringOverview,
} from "@ploydok/shared"

// ---------------------------------------------------------------------------
// useMonitoring — GET /monitoring/overview, polled every 5 s
// ---------------------------------------------------------------------------

export function useMonitoring() {
  const backendUnavailable = useBackendUnavailable()

  return useQuery<MonitoringOverview, ApiError>({
    queryKey: ["monitoring", "overview"],
    queryFn: async () => {
      const { response, data } = await apiFetchAllowErrorBody<MonitoringOverview>(
        "/monitoring/overview",
        {
          method: "GET",
          credentials: "include",
        },
      )
      if (!data) {
        throw new Error(`Monitoring request failed with status ${response.status}`)
      }
      return data
    },
    refetchInterval: backendUnavailable.active
      ? false
      : 5000,
    staleTime: 2000,
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    enabled: !backendUnavailable.active,
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
      apiFetch<PingResult>(
        `/monitoring/ping/${encodeURIComponent(args.id)}`,
        {
          method: "POST",
          body: JSON.stringify({
            path: args.path,
            port: args.port,
            timeoutMs: args.timeoutMs,
          }),
        },
      ),
  })
}

// ---------------------------------------------------------------------------
// useMonitoringEvents — s'abonne au stream /events partagé via EventsProvider.
// ---------------------------------------------------------------------------

export function useMonitoringEvents(
  onChange: (container: ContainerSnapshot) => void,
): void {
  useEventsSubscription<MonitoringEvent>("container.health", (monEv) => {
    onChange(monEv.container)
  })
}
