// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {

  useCommandPalette
} from "./use-command-palette"
import type {UseCommandPaletteReturn} from "./use-command-palette";

const CommandPaletteContext =
  React.createContext<UseCommandPaletteReturn | null>(null)

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useCommandPalette()
  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPaletteContext(): UseCommandPaletteReturn {
  const ctx = React.useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error(
      "useCommandPaletteContext must be used within CommandPaletteProvider",
    )
  }
  return ctx
}
