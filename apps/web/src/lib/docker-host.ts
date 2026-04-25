// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "./api"

export interface DockerContainerSnapshot {
  id: string
  name: string
  image: string
  status: string
  uptime_s: number
  cpu_pct: number
  mem_bytes: number
  mem_limit_bytes: number
  restart_count: number
  kind: string
  app_id: string
}

export function useDockerContainers() {
  return useQuery({
    queryKey: ["docker-host", "containers"],
    queryFn: async () => {
      const data = await apiFetch<{ containers: DockerContainerSnapshot[] }>(
        "/docker/containers"
      )
      return data.containers
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}
