// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "./api/client"

export type ComponentStatus = "ok" | "degraded" | "down" | "unknown"

export interface SystemHealthReport {
  ok: boolean
  version: string
  components: {
    db: { status: ComponentStatus; latency_ms?: number; error?: string }
    agent: { status: ComponentStatus; socket?: string; error?: string }
    caddy: { status: ComponentStatus; admin_url?: string; error?: string }
  }
}

export function useSystemHealth(): {
  data: SystemHealthReport | undefined
  isLoading: boolean
  error: Error | null
  refetch: () => void
} {
  const q = useQuery<SystemHealthReport>({
    queryKey: ["system", "health"],
    queryFn: () => apiFetch<SystemHealthReport>("/health/ready"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
  return {
    data: q.data,
    isLoading: q.isLoading,
    error: q.error,
    refetch: () => void q.refetch(),
  }
}
