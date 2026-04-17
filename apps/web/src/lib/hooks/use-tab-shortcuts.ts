// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import type { AnyRouter } from "@tanstack/react-router"

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

export type ShortcutState =
  | { phase: "idle" }
  | { phase: "awaiting"; startedAt: number }

export type ShortcutAction =
  | { type: "key"; key: string; modKey: boolean; ignored: boolean; now: number }
  | { type: "tick"; now: number }

export interface ShortcutResult {
  state: ShortcutState
  navigateTo?: TabSegment
}

// ---------------------------------------------------------------------------
// Shortcut map: second key → route segment
// ---------------------------------------------------------------------------

export type TabSegment =
  | "overview"
  | "deployments"
  | "logs"
  | "settings"
  | "env"
  | "domains"

export const SHORTCUT_MAP: Partial<Record<string, TabSegment>> = {
  o: "overview",
  d: "deployments",
  l: "logs",
  s: "settings",
  e: "env",
  n: "domains",
}

export const TIMEOUT_MS = 1500

// ---------------------------------------------------------------------------
// Pure state machine — exported for unit testing without DOM
// ---------------------------------------------------------------------------

/**
 * Pure transition function for the `g+x` keyboard shortcut state machine.
 *
 * Rules:
 * - `ignored` events → no-op (focus is in an input/modal)
 * - modifier key held → reset to idle
 * - idle + "g" pressed → awaiting(startedAt=now)
 * - awaiting + tick past timeout → idle
 * - awaiting + matching target key → navigateTo + idle
 * - awaiting + any other key → idle
 */
export function nextState(s: ShortcutState, a: ShortcutAction): ShortcutResult {
  if (a.type === "tick") {
    if (s.phase === "awaiting" && a.now - s.startedAt > TIMEOUT_MS) {
      return { state: { phase: "idle" } }
    }
    return { state: s }
  }

  // type === "key"
  if (a.ignored) {
    return { state: s }
  }

  if (a.modKey) {
    return { state: { phase: "idle" } }
  }

  if (s.phase === "idle") {
    if (a.key === "g") {
      return { state: { phase: "awaiting", startedAt: a.now } }
    }
    return { state: s }
  }

  // phase === "awaiting"
  if (a.now - s.startedAt > TIMEOUT_MS) {
    // Already timed out — treat as idle, but still process this key
    if (a.key === "g") {
      return { state: { phase: "awaiting", startedAt: a.now } }
    }
    return { state: { phase: "idle" } }
  }

  const target = SHORTCUT_MAP[a.key]
  if (target) {
    return { state: { phase: "idle" }, navigateTo: target }
  }

  // Unknown key while awaiting — cancel
  return { state: { phase: "idle" } }
}

// ---------------------------------------------------------------------------
// Typed navigation helper
// ---------------------------------------------------------------------------

// Mapping TabSegment → typed route path for TanStack Router.
// Using an explicit switch avoids `as never` casts and keeps full type safety.
function navigateToTab(
  router: AnyRouter,
  appId: string,
  tab: TabSegment,
): void {
  const params = { id: appId }
  switch (tab) {
    case "overview":
      void router.navigate({ to: "/apps/$id/overview", params })
      break
    case "deployments":
      void router.navigate({ to: "/apps/$id/deployments", params })
      break
    case "logs":
      void router.navigate({ to: "/apps/$id/logs", params })
      break
    case "settings":
      void router.navigate({ to: "/apps/$id/settings", params })
      break
    case "env":
      void router.navigate({ to: "/apps/$id/env", params })
      break
    case "domains":
      void router.navigate({ to: "/apps/$id/domains", params })
      break
  }
}

// ---------------------------------------------------------------------------
// Focus guard — returns true when keyboard shortcuts should be suppressed
// ---------------------------------------------------------------------------

function isFocusIgnored(): boolean {
  const el = document.activeElement
  if (!el) return false

  const tag = el.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea" || tag === "select") return true
  if (el.getAttribute("contenteditable") !== null) return true

  // Suppress when a dialog/modal is open
  if (document.querySelector('[role="dialog"][data-state="open"]')) return true

  return false
}

// ---------------------------------------------------------------------------
// useTabShortcuts hook
// ---------------------------------------------------------------------------

/**
 * Installs global `g+x` keyboard shortcuts that navigate between the tabs of
 * an app-detail page (pattern inspired by GitHub).
 *
 * Must be mounted inside a component that has access to the router (i.e. inside
 * a TanStack Router route or layout).
 */
export function useTabShortcuts(appId: string): void {
  const router = useRouter()
  const stateRef = React.useRef<ShortcutState>({ phase: "idle" })
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleReset = React.useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      const result = nextState(stateRef.current, { type: "tick", now: Date.now() })
      stateRef.current = result.state
    }, TIMEOUT_MS)
  }, [clearTimer])

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const modKey =
        event.ctrlKey || event.metaKey || event.altKey

      const action: ShortcutAction = {
        type: "key",
        key: event.key.toLowerCase(),
        modKey,
        ignored: isFocusIgnored(),
        now: Date.now(),
      }

      const result = nextState(stateRef.current, action)
      stateRef.current = result.state

      if (result.navigateTo) {
        clearTimer()
        navigateToTab(router, appId, result.navigateTo)
        return
      }

      if (result.state.phase === "awaiting") {
        scheduleReset()
      } else {
        clearTimer()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      clearTimer()
    }
  }, [appId, router, clearTimer, scheduleReset])
}

