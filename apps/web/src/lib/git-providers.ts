// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query"
import { apiFetch, criticalRetryDelay, shouldRetryCriticalQuery } from "./api"
import type { ApiError } from "./api"

export interface GitProviderStatus {
  ready: boolean
  github: {
    configured: boolean
    connected: boolean
    install_url?: string | null
  }
  gitlab: {
    configured: boolean
    connected: boolean
    connect_url?: string | null
  }
}

export function getGitProviderStatus(): Promise<GitProviderStatus> {
  return apiFetch<GitProviderStatus>("/git-providers/status")
}

export function useGitProviderStatus() {
  return useQuery<GitProviderStatus, ApiError>({
    queryKey: ["git-providers", "status"],
    queryFn: getGitProviderStatus,
    staleTime: 30_000,
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    meta: { critical: true },
  })
}
