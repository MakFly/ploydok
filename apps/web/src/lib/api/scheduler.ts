// SPDX-License-Identifier: AGPL-3.0-only
// Client-only. Schedules a proactive refresh ~60s before the access token
// expires so the user never sees a 401 during normal use. The reactive 401
// fallback in apiFetch remains active as a safety net.

import { getAccessExpiry as defaultGetAccessExpiry, triggerRefresh as defaultTriggerRefresh } from "../api"

const REFRESH_LEEWAY_SECS = 60

export interface ProactiveRefresh {
  stop: () => void
  reschedule: () => void
}

export interface SchedulerDeps {
  getAccessExpiry?: () => number | null
  triggerRefresh?: () => Promise<unknown>
  // Defaults to the global window/document. Override in tests.
  now?: () => number
}

export function startProactiveRefresh(deps: SchedulerDeps = {}): ProactiveRefresh {
  if (typeof window === "undefined") {
    return { stop: () => undefined, reschedule: () => undefined }
  }
  const getAccessExpiry = deps.getAccessExpiry ?? defaultGetAccessExpiry
  const triggerRefresh = deps.triggerRefresh ?? defaultTriggerRefresh
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  const fire = (): void => {
    timeoutId = null
    void triggerRefresh().catch(() => undefined)
  }

  const reschedule = (): void => {
    clear()
    const exp = getAccessExpiry()
    if (exp === null) return
    // Don't refresh in background tabs — wait for visibilitychange. Saves
    // pointless network traffic on tabs the user has not touched in hours.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const nowSecs = now()
    const delaySecs = Math.max(0, exp - nowSecs - REFRESH_LEEWAY_SECS)
    if (delaySecs === 0) {
      fire()
    } else {
      timeoutId = setTimeout(fire, delaySecs * 1000)
    }
  }

  const onVis = (): void => {
    if (typeof document === "undefined") return
    if (document.visibilityState === "visible") reschedule()
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis)
  }

  reschedule()

  return {
    stop: () => {
      clear()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis)
      }
    },
    reschedule,
  }
}
