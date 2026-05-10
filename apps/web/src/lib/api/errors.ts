// SPDX-License-Identifier: AGPL-3.0-only

import { apiBaseUrl } from "./base"

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, "SESSION_EXPIRED", "Session expired, please sign in again")
    this.name = "SessionExpiredError"
  }
}

export class SecondFactorRequiredError extends ApiError {
  constructor(
    message = "Configurez un second facteur pour déverrouiller cette action."
  ) {
    super(403, "SECOND_FACTOR_REQUIRED", message)
    this.name = "SecondFactorRequiredError"
  }
}

export class BackendUnavailableError extends ApiError {
  constructor(
    message = `Le frontend ne parvient plus a joindre l'API sur ${apiBaseUrl()}.`
  ) {
    super(503, "BACKEND_UNAVAILABLE", message)
    this.name = "BackendUnavailableError"
  }
}

export type RefreshResult =
  | { ok: true; accessExpiresAt: number | null }
  | { ok: false; reason: "refresh_expired" | "network_error" | "server_error" }

export function shouldRetryCriticalQuery(
  failureCount: number,
  error: ApiError
): boolean {
  if (error.status === 401) return false
  if (error instanceof BackendUnavailableError) return failureCount < 1
  return error.status >= 500 && error.status < 600 && failureCount < 2
}

export function criticalRetryDelay(
  attemptIndex: number,
  error: ApiError
): number {
  if (error instanceof BackendUnavailableError) return 150
  return Math.min(1000 * 2 ** attemptIndex, 30_000)
}

// Shared defaults for "critical" queries (apps, monitoring, auth, …).
// Tagging a query with these options enables:
//   - meta.critical=true → BackendUnavailable surfacing via QueryCache.onError
//   - bounded retry + backoff for 5xx and network errors
//   - refetchOnWindowFocus=true so a long-idle tab catches up after focus
//   - global visibilitychange listener (in __root.tsx) invalidates these
//     queries when the tab becomes visible, covering missed SSE events.
export const criticalQueryDefaults = {
  retry: shouldRetryCriticalQuery,
  retryDelay: criticalRetryDelay,
  refetchOnWindowFocus: true,
  meta: { critical: true } as const,
} as const
