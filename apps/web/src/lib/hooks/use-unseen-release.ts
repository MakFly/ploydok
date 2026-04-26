// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

const STORAGE_KEY = "ploydok.lastSeenVersion"

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"

function readLastSeen(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeLastSeen(version: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, version)
  } catch {
    // localStorage unavailable (private mode, quota) — silent no-op.
  }
}

/**
 * Tracks whether the running build version has been "seen" by the user.
 *
 * - `unseen` flips to true whenever `import.meta`-injected `__APP_VERSION__`
 *   differs from the value stored in `localStorage`.
 * - `markSeen()` writes the current version, clearing the flag.
 *
 * Fully dynamic: no hardcoded changelog text, no manual reset. The badge
 * disappears for good once the user opens the Guide / release notes after a
 * deploy, and reappears on the next version bump.
 */
export function useUnseenRelease(): {
  version: string
  unseen: boolean
  markSeen: () => void
} {
  const [unseen, setUnseen] = React.useState(false)

  React.useEffect(() => {
    setUnseen(readLastSeen() !== APP_VERSION)
  }, [])

  const markSeen = React.useCallback(() => {
    writeLastSeen(APP_VERSION)
    setUnseen(false)
  }, [])

  return { version: APP_VERSION, unseen, markSeen }
}
