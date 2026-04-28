// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"

export type ThemeMode = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export const THEME_COOKIE = "ploydok-theme"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function readCookie(): ThemeMode {
  if (typeof document === "undefined") return "system"
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + THEME_COOKIE + "=([^;]+)")
  )
  const value = match ? decodeURIComponent(match[1]) : null
  if (value === "light" || value === "dark" || value === "system") return value
  return "system"
}

function writeCookie(mode: ThemeMode): void {
  if (typeof document === "undefined") return
  document.cookie =
    THEME_COOKIE +
    "=" +
    encodeURIComponent(mode) +
    "; path=/; max-age=" +
    COOKIE_MAX_AGE +
    "; samesite=lax"
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light"
  return mode
}

function applyResolved(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", resolved === "dark")
  document.documentElement.style.colorScheme = resolved
}

export function useTheme(): {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  toggle: () => void
} {
  const [mode, setModeState] = React.useState<ThemeMode>(readCookie)
  const [resolved, setResolved] = React.useState<ResolvedTheme>(() =>
    resolve(readCookie())
  )

  React.useEffect(() => {
    const next = resolve(mode)
    setResolved(next)
    applyResolved(next)
    writeCookie(mode)
  }, [mode])

  // Follow OS pref changes when in system mode
  React.useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent): void => {
      const next: ResolvedTheme = e.matches ? "dark" : "light"
      setResolved(next)
      applyResolved(next)
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [mode])

  // Sync across tabs via cookie polling on focus
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const onFocus = (): void => {
      const fromCookie = readCookie()
      if (fromCookie !== mode) setModeState(fromCookie)
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [mode])

  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next)
  }, [])

  const toggle = React.useCallback(() => {
    setModeState((prev) => {
      const current = resolve(prev)
      return current === "dark" ? "light" : "dark"
    })
  }, [])

  return { mode, resolved, setMode, toggle }
}

export function ThemeToggle(): React.JSX.Element {
  const { resolved, toggle } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
    >
      {resolved === "dark" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </Button>
  )
}
