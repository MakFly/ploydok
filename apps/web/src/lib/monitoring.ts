// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { apiFetch } from "./api"
import type {
  ContainerSnapshot,
  MonitoringEvent,
  MonitoringOverview,
} from "@ploydok/shared"


// Mirrors API_BASE from api.ts — not exported there.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000"

// ---------------------------------------------------------------------------
// useMonitoring — GET /monitoring/overview, polled every 5 s
// ---------------------------------------------------------------------------

export function useMonitoring() {
  return useQuery<MonitoringOverview>({
    queryKey: ["monitoring", "overview"],
    // apiFetch throw sur !res.ok, mais le 503 nous renvoie un payload valide.
    // On passe donc par fetch natif pour récupérer le body même en erreur.
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/monitoring/overview`, {
        credentials: "include",
      })
      const data = (await res.json()) as MonitoringOverview
      return data
    },
    refetchInterval: 5000,
    staleTime: 2000,
    retry: false,
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
// useMonitoringEvents — dedicated SSE listener for "container.health" events.
// Opens a second EventSource (simpler than coupling with useNotifications).
// ---------------------------------------------------------------------------

export function useMonitoringEvents(
  onChange: (container: ContainerSnapshot) => void,
): void {
  // Stable ref so the effect captures the latest callback without re-subscribing.
  const cbRef = useRef(onChange)
  useEffect(() => {
    cbRef.current = onChange
  })

  useEffect(() => {
    // Gate: EventSource is not available in the SSR environment.
    if (typeof window === "undefined") return

    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true })

    function handleHealth(ev: Event): void {
      const msgEvent = ev as MessageEvent<string>
      let parsed: unknown
      try {
        parsed = JSON.parse(msgEvent.data)
      } catch {
        return
      }
      const monEv = parsed as MonitoringEvent
      cbRef.current(monEv.container)
    }

    es.addEventListener("container.health", handleHealth)

    return () => {
      es.removeEventListener("container.health", handleHealth)
      es.close()
    }
  }, [])
}
