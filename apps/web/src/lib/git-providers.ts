// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query"
import { apiFetch, criticalRetryDelay, shouldRetryCriticalQuery } from "./api"
import i18n from "./i18n"
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
    state?:
      | "not_configured"
      | "disconnected"
      | "expired"
      | "unavailable"
      | "connected"
    connect_url?: string | null
  }
}

export interface GitLabSourceAvailability {
  enabled: boolean
  reason: string | null
}

export function getGitLabSourceAvailability(
  status: GitProviderStatus | undefined,
  options: { loading?: boolean; failed?: boolean } = {}
): GitLabSourceAvailability {
  if (options.loading && !status) {
    return { enabled: false, reason: i18n.t("settings:gitlab.checking") }
  }
  if (options.failed && !status) {
    return {
      enabled: false,
      reason: i18n.t("settings:gitlab.checkFailed"),
    }
  }
  if (!status?.gitlab.configured) {
    return {
      enabled: false,
      reason: i18n.t("settings:gitlab.needsAdmin"),
    }
  }
  if (status.gitlab.state === "unavailable") {
    return {
      enabled: false,
      reason: i18n.t("settings:gitlab.unavailable"),
    }
  }
  if (status.gitlab.state === "expired") {
    return {
      enabled: false,
      reason: i18n.t("settings:gitlab.expired"),
    }
  }
  if (!status.gitlab.connected) {
    return {
      enabled: false,
      reason: i18n.t("settings:gitlab.connectInSettings"),
    }
  }
  return { enabled: true, reason: null }
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
