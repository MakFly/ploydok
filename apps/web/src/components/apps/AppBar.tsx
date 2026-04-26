// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { RiTerminalBoxLine } from "@remixicon/react"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { AppHeaderActions } from "./AppHeaderActions"
import { DeleteAppButton } from "./DeleteAppButton"
import { useTabShortcuts } from "../../lib/hooks/use-tab-shortcuts"
import type { AppDetail } from "../../lib/apps"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../lib/organizations"

interface NavItem {
  value: string
  label: string
  segment: string
  /** When true, the tab requires app.status === "running" to be active. */
  requiresRunning?: boolean
}

const NAV_ITEMS: Array<NavItem> = [
  { value: "settings", label: "General", segment: "settings" },
  { value: "env", label: "Env", segment: "env" },
  { value: "domains", label: "Domains", segment: "domains" },
  { value: "deployments", label: "Deployments", segment: "deployments" },
  { value: "previews", label: "Previews", segment: "previews" },
  { value: "logs", label: "Logs", segment: "logs", requiresRunning: true },
  { value: "advanced", label: "Advanced", segment: "advanced" },
]

export function AppBar({ app }: { app: AppDetail }): React.JSX.Element {
  const currentOrgSlug = useCurrentOrganizationSlug()
  useTabShortcuts(app.id, currentOrgSlug)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const resolvedItems = React.useMemo(
    () =>
      NAV_ITEMS.map((item) => {
        const to = currentOrgSlug
          ? organizationPath(currentOrgSlug, `apps/${app.id}/${item.segment}`)
          : `/apps/${app.id}/${item.segment}`
        const disabled =
          item.requiresRunning === true && app.status !== "running"
        return { ...item, to, disabled }
      }),
    [app.id, app.status, currentOrgSlug]
  )

  const activeValue =
    resolvedItems.find(
      ({ to }) => pathname === to || pathname.startsWith(`${to}/`)
    )?.value ?? "settings"

  const shellHref = currentOrgSlug
    ? organizationPath(currentOrgSlug, `apps/${app.id}/shell`)
    : `/apps/${app.id}/shell`
  const shellDisabled = app.status !== "running"

  return (
    <div className="flex w-full shrink-0 flex-col gap-3 px-4 py-3 md:px-8">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <AppHeaderActions app={app} />
        {shellDisabled ? (
          <Button
            size="sm"
            variant="ghost"
            disabled
            className="gap-1.5"
            title={`Available when the app is running (current: ${app.status})`}
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

      <Tabs value={activeValue}>
        <TabsList>
          {resolvedItems.map((item) =>
            item.disabled ? (
              <TabsTrigger
                key={item.value}
                value={item.value}
                disabled
                title={`Available when the app is running (current: ${app.status})`}
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
