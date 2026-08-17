// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { RiExternalLinkLine, RiTerminalBoxLine } from "@remixicon/react"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useTabShortcuts } from "../../lib/hooks/use-tab-shortcuts"
import { resolveDisplayedAppState } from "../../lib/app-runtime"
import { useMonitoring } from "../../lib/monitoring"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../lib/organizations"
import { AppHeaderActions } from "./AppHeaderActions"
import { AppIcon } from "./AppIcon"
import { AppStatusBadge } from "./AppStatusBadge"
import { DeleteAppButton } from "./DeleteAppButton"
import type { AppDetail } from "../../lib/apps"
import type { AppHealth } from "../../lib/app-runtime"

interface NavItem {
  value: string
  label: string
  segment: string
  /** When true, the tab requires app.status === "running" to be active. */
  requiresRunning?: boolean
}

const NAV_ITEMS: Array<NavItem> = [
  { value: "settings", label: "General", segment: "settings" },
  { value: "deployments", label: "Deployments", segment: "deployments" },
  { value: "logs", label: "Logs", segment: "logs", requiresRunning: true },
  { value: "env", label: "Env", segment: "env" },
  { value: "domains", label: "Domains", segment: "domains" },
  { value: "storage", label: "Storage", segment: "storage" },
  { value: "previews", label: "Previews", segment: "previews" },
  { value: "security", label: "Security", segment: "security" },
  { value: "advanced", label: "Advanced", segment: "advanced" },
]

export function AppBar({ app }: { app: AppDetail }): React.JSX.Element {
  const currentOrgSlug = useCurrentOrganizationSlug()
  useTabShortcuts(app.id, currentOrgSlug)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: monitoring } = useMonitoring()
  const displayedState = resolveDisplayedAppState(app, monitoring?.containers)
  const displayedApp = React.useMemo(
    () => ({ ...app, status: displayedState.status ?? app.status }),
    [app, displayedState.status]
  )

  const resolvedItems = React.useMemo(
    () =>
      NAV_ITEMS.map((item) => {
        const to = currentOrgSlug
          ? organizationPath(currentOrgSlug, `apps/${app.id}/${item.segment}`)
          : `/apps/${app.id}/${item.segment}`
        const disabled =
          item.requiresRunning === true && displayedApp.status !== "running"
        return { ...item, to, disabled }
      }),
    [app.id, currentOrgSlug, displayedApp.status]
  )

  const activeValue =
    resolvedItems.find(
      ({ to }) => pathname === to || pathname.startsWith(`${to}/`)
    )?.value ?? "settings"

  const shellHref = currentOrgSlug
    ? organizationPath(currentOrgSlug, `apps/${app.id}/shell`)
    : `/apps/${app.id}/shell`
  const shellDisabled = displayedApp.status !== "running"

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 px-4 py-4 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <AppIdentity app={displayedApp} health={displayedState.health} />

        <div className="flex flex-wrap items-center gap-1.5">
          <AppHeaderActions app={displayedApp} />
          {shellDisabled ? (
            <Button
              size="sm"
              variant="ghost"
              disabled
              className="gap-1.5"
              title={`Available when the app is running (current: ${displayedApp.status})`}
            >
              <RiTerminalBoxLine className="size-4" aria-hidden="true" />
              Shell
            </Button>
          ) : (
            <Button size="sm" variant="ghost" asChild className="gap-1.5">
              <Link to={shellHref as never}>
                <RiTerminalBoxLine className="size-4" aria-hidden="true" />
                Shell
              </Link>
            </Button>
          )}
          <DeleteAppButton app={app} />
        </div>
      </div>

      <Tabs value={activeValue}>
        <TabsList>
          {resolvedItems.map((item) =>
            item.disabled ? (
              <TabsTrigger
                key={item.value}
                value={item.value}
                disabled
                title={`Available when the app is running (current: ${displayedApp.status})`}
              >
                {item.label}
              </TabsTrigger>
            ) : (
              <TabsTrigger key={item.value} value={item.value} asChild>
                <Link to={item.to as never}>{item.label}</Link>
              </TabsTrigger>
            )
          )}
        </TabsList>
      </Tabs>
    </div>
  )
}

function AppIdentity({
  app,
  health,
}: {
  app: AppDetail
  health: AppHealth | null
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AppIcon name={app.name} src={app.iconUrl} className="size-10" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="truncate font-heading text-base leading-tight font-semibold">
            {app.name}
          </h1>
          <AppStatusBadge status={app.status} health={health} />
        </div>
        {app.domain ? (
          <a
            className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            href={app.publicUrl ?? `http://${app.domain}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="truncate">{app.domain}</span>
            <RiExternalLinkLine
              className="size-3 shrink-0"
              aria-hidden="true"
            />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">No domain yet</span>
        )}
      </div>
    </div>
  )
}
