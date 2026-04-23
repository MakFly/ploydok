// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  RiDashboardLine,
  RiGlobalLine,
  RiKey2Line,
  RiRocketLine,
  RiSettings3Line,
  RiTerminalBoxLine,
  RiTerminalLine,
} from "@remixicon/react"
import { DeployButton } from "./DeployButton"
import { ActionsMenu } from "./ActionsMenu"
import { useTabShortcuts } from "../../lib/hooks/use-tab-shortcuts"
import type { AppDetail } from "../../lib/apps"
import { organizationPath, useCurrentOrganizationSlug } from "../../lib/organizations"

// ---------------------------------------------------------------------------
// AppBar — single row, tabs + primary actions. No meta, no border.
// Tabs scroll horizontally on overflow; Deploy + Actions pinned on the right.
// ---------------------------------------------------------------------------

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: Array<NavItem> = [
  { label: "Overview", to: "/apps/$id/overview", icon: RiDashboardLine },
  { label: "Deployments", to: "/apps/$id/deployments", icon: RiRocketLine },
  { label: "Logs", to: "/apps/$id/logs", icon: RiTerminalLine },
  { label: "Shell", to: "/apps/$id/shell", icon: RiTerminalBoxLine },
  { label: "Settings", to: "/apps/$id/settings", icon: RiSettings3Line },
  { label: "Env", to: "/apps/$id/env", icon: RiKey2Line },
  { label: "Domains", to: "/apps/$id/domains", icon: RiGlobalLine },
]

export function AppBar({ app }: { app: AppDetail }): React.JSX.Element {
  const currentOrgSlug = useCurrentOrganizationSlug()
  useTabShortcuts(app.id, currentOrgSlug)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeTabRef = React.useRef<HTMLAnchorElement | null>(null)

  React.useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    })
  }, [pathname])

  return (
    <div className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center gap-2 bg-background/85 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/65 md:px-4">
      <nav
        role="tablist"
        aria-label="App sections"
        className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const resolved = currentOrgSlug
            ? organizationPath(currentOrgSlug, item.to.replace("/apps/$id/", `apps/${app.id}/`))
            : item.to.replace("$id", app.id)
          const isActive =
            pathname === resolved || pathname.startsWith(resolved + "/")
          const Icon = item.icon
          return (
            <Link
              key={item.label}
              to={resolved as never}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              ref={isActive ? activeTabRef : undefined}
              className={[
                "my-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="size-3.5 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <DeployButton appId={app.id} />
        <ActionsMenu app={app} />
      </div>
    </div>
  )
}
