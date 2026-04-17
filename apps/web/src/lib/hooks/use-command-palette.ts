// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

export interface UseCommandPaletteReturn {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggle: () => void
}

// ---------------------------------------------------------------------------
// Pure keyboard event logic — exported for unit tests
// ---------------------------------------------------------------------------

export interface KeyEventInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
}

export type KeyEventResult =
  | { action: "toggle"; preventDefault: true }
  | { action: "close"; preventDefault: true }
  | { action: "none"; preventDefault: false }

export function resolveKeyAction(
  e: KeyEventInput,
  currentlyOpen: boolean,
): KeyEventResult {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    return { action: "toggle", preventDefault: true }
  }
  if (e.key === "Escape" && currentlyOpen) {
    return { action: "close", preventDefault: true }
  }
  return { action: "none", preventDefault: false }
}

// ---------------------------------------------------------------------------
// Hook — local state, global keydown listener
// ---------------------------------------------------------------------------

export function useCommandPalette(): UseCommandPaletteReturn {
  const [open, setOpen] = React.useState(false)

  const toggle = React.useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const result = resolveKeyAction(
        { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey },
        open,
      )
      if (result.preventDefault) {
        e.preventDefault()
      }
      if (result.action === "toggle") {
        toggle()
      } else if (result.action === "close") {
        setOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, toggle])

  return { open, setOpen, toggle }
}
