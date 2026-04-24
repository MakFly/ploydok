// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { DeployButton } from "./DeployButton"
import { ActionsMenu } from "./ActionsMenu"
import { useTabShortcuts } from "../../lib/hooks/use-tab-shortcuts"
import type { AppDetail } from "../../lib/apps"
import { organizationPath, useCurrentOrganizationSlug } from "../../lib/organizations"

interface NavItem {
  value: string
  label: string
  segment: string
}

const NAV_ITEMS: Array<NavItem> = [
  { value: "overview", label: "Overview", segment: "overview" },
  { value: "deployments", label: "Deployments", segment: "deployments" },
  { value: "logs", label: "Logs", segment: "logs" },
  { value: "shell", label: "Shell", segment: "shell" },
  { value: "settings", label: "Settings", segment: "settings" },
  { value: "env", label: "Env", segment: "env" },
  { value: "domains", label: "Domains", segment: "domains" },
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
        return { ...item, to }
      }),
    [app.id, currentOrgSlug],
  )

  const activeValue =
    resolvedItems.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`))?.value ??
    "overview"

  return (
    <div className="flex w-full shrink-0 flex-wrap items-center gap-3 px-4 py-3 md:px-6">
      <Tabs value={activeValue}>
        <TabsList>
          {resolvedItems.map((item) => (
            <TabsTrigger key={item.value} value={item.value} asChild>
              <Link to={item.to as never}>{item.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <DeployButton appId={app.id} />
        <ActionsMenu app={app} />
      </div>
    </div>
  )
}
