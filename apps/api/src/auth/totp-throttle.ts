// SPDX-License-Identifier: AGPL-3.0-only
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

interface FailureBucket {
  count: number
  resetAt: number
}

// WHY: this pass has no shared Redis rate-limit helper for authenticated TOTP
// checks. This protects single-instance deployments; multi-instance installs
// need a shared store before scaling API replicas.
const failures = new Map<string, FailureBucket>()

export interface TotpThrottleResult {
  locked: boolean
  retryAfterSec: number
}

export function recordTotpFailure(userId: string, nowMs = Date.now()): TotpThrottleResult {
  const current = failures.get(userId)
  const bucket =
    current && current.resetAt > nowMs
      ? current
      : { count: 0, resetAt: nowMs + WINDOW_MS }

  if (bucket.count >= MAX_FAILURES) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((bucket.resetAt - nowMs) / 1000),
    }
  }

  bucket.count += 1
  failures.set(userId, bucket)

  return {
    locked: false,
    retryAfterSec: Math.ceil((bucket.resetAt - nowMs) / 1000),
  }
}

export function resetTotpFailures(userId: string): void {
  failures.delete(userId)
}

export function resetAllTotpFailuresForTests(): void {
  failures.clear()
}
