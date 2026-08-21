// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "../i18n"
import { apiBaseUrl } from "./base"

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /**
     * Erreurs par champ renvoyées par une validation Zod côté API
     * (`fieldErrors` de @ploydok/shared). Permet à un formulaire d'annoter le
     * champ fautif au lieu de n'afficher qu'un bandeau global.
     */
    public fields?: Record<string, string>
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, "SESSION_EXPIRED", i18n.t("errors:codes.SESSION_EXPIRED"))
    this.name = "SessionExpiredError"
  }
}

export class SecondFactorRequiredError extends ApiError {
  constructor(
    message = i18n.t("errors:codes.SECOND_FACTOR_REQUIRED")
  ) {
    super(403, "SECOND_FACTOR_REQUIRED", message)
    this.name = "SecondFactorRequiredError"
  }
}

export class BackendUnavailableError extends ApiError {
  constructor(
    message = i18n.t("errors:backendUnavailableBody", { url: apiBaseUrl() })
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
