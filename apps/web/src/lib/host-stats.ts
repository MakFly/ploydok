// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "./api"

export interface HostStats {
  cpu_percent: number
  cpu_count: number
  mem_total_bytes: number
  mem_used_bytes: number
  mem_available_bytes: number
  swap_total_bytes: number
  swap_used_bytes: number
  load_1: number
  load_5: number
  load_15: number
  disk_total_bytes: number
  disk_used_bytes: number
  disk_free_bytes: number
  inodes_total: number
  inodes_used: number
  uptime_seconds: number
  gpu_count: number
  gpu_utilization_pct: number
  gpu_mem_used_bytes: number
  gpu_mem_total_bytes: number
  gpu_name: string
  thresholds: {
    disk_warn_pct: number
    mem_warn_pct: number
    load_warn_per_cpu: number
  }
  alerts: Array<string>
  error: string
  fetched_at: number
}

export function useHostStats(): {
  data: HostStats | undefined
  isLoading: boolean
  error: Error | null
} {
  const q = useQuery<HostStats>({
    queryKey: ["host-stats"],
    queryFn: () => apiFetch<HostStats>("/host-stats"),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  })
  return {
    data: q.data,
    isLoading: q.isLoading,
    error: q.error,
  }
}
