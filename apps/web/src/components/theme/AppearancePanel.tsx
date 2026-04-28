// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import {  useTheme } from "./ThemeToggle"
import type {ThemeMode} from "./ThemeToggle";

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  {
    value: "light",
    label: "Light",
    hint: "Always use the light theme.",
    icon: RiSunLine,
  },
  {
    value: "dark",
    label: "Dark",
    hint: "Always use the dark theme.",
    icon: RiMoonLine,
  },
  {
    value: "system",
    label: "System",
    hint: "Follow your operating system preference.",
    icon: RiComputerLine,
  },
]

export function AppearancePanel(): React.JSX.Element {
  const { mode, resolved, setMode } = useTheme()
  return (
    <section
      aria-label="Appearance"
      className="space-y-4 rounded-xl border border-border bg-card p-5"
    >
      <div>
        <h3 className="text-sm font-medium">Appearance</h3>
        <p className="text-xs text-muted-foreground">
          Choose how Ploydok looks to you. Saved as a cookie for one year and
          synced across tabs.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid gap-2 sm:grid-cols-3"
      >
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const active = mode === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMode(opt.value)}
              className={cn(
                "flex w-full flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-foreground/20 hover:bg-muted/40"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4" />
                {opt.label}
              </span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Currently rendering in <span className="font-mono">{resolved}</span>{" "}
        mode.
      </p>
    </section>
  )
}
