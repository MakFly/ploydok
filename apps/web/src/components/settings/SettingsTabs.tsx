// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  RiShip2Line,
  RiGitMergeLine,
  RiShieldCheckLine,
  RiUserLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"

interface SettingsTab {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  matches: (pathname: string) => boolean
}

const TABS: ReadonlyArray<SettingsTab> = [
  {
    to: "/settings",
    label: "Account",
    icon: RiUserLine,
    matches: (p) => p === "/settings" || p === "/settings/",
  },
  {
    to: "/settings/security",
    label: "Security",
    icon: RiShieldCheckLine,
    matches: (p) => p.startsWith("/settings/security"),
  },
  {
    to: "/settings/git-providers",
    label: "Git providers",
    icon: RiGitMergeLine,
    matches: (p) => p.startsWith("/settings/git-providers"),
  },
  {
    to: "/settings/registry",
    label: "Registry",
    icon: RiShip2Line,
    matches: (p) => p.startsWith("/settings/registry"),
  },
]

export function SettingsTabs(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="inline-flex w-full items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 md:w-auto"
    >
      {TABS.map(({ to, label, icon: Icon, matches }) => {
        const active = matches(pathname)
        return (
          <Link
            key={to}
            to={to}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:flex-none",
              active
                ? "bg-background text-foreground shadow-[0_0_0_1px_var(--border)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        )
      })}
    </div>
  )
}
