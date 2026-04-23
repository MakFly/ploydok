// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
  createFileRoute,
} from "@tanstack/react-router"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { AppStatusBadge } from "../../../../../../components/apps/AppStatusBadge"
import { useApp } from "../../../../../../lib/apps"
import { organizationPath, useCurrentOrganizationSlug } from "../../../../../../lib/organizations"

function AppSettingsLayout(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const currentOrgSlug = useCurrentOrganizationSlug()
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { data: app } = useApp(id)

  const tabs = [
    {
      value: "general",
      to: currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${id}/settings`) : `/apps/${id}/settings`,
      label: "General",
      exact: true,
    },
    {
      value: "webhooks",
      to: currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${id}/settings/webhooks`) : `/apps/${id}/settings/webhooks`,
      label: "Webhooks",
      exact: false,
    },
    {
      value: "secret",
      to: currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${id}/settings/webhook-secret`) : `/apps/${id}/settings/webhook-secret`,
      label: "Secret",
      exact: false,
    },
    {
      value: "notifications",
      to: currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${id}/settings/notifications`) : `/apps/${id}/settings/notifications`,
      label: "Notifications",
      exact: false,
    },
    {
      value: "protection",
      to: currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${id}/settings/protection`) : `/apps/${id}/settings/protection`,
      label: "Protection",
      exact: false,
    },
  ]

  const activeTab =
    tabs.find(({ to, exact }) =>
      exact ? pathname === to || pathname === `${to}/` : pathname.startsWith(to)
    )?.value ?? "general"

  return (
    <div className="flex w-full flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl leading-tight">Settings</h1>
          {app ? <AppStatusBadge status={app.status} /> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {app?.name ?? "Application"} configuration and webhook controls.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = tabs.find((tab) => tab.value === value)
          if (!next) return
          void navigate({ href: next.to })
        }}
      >
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link to={tab.to as never}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings")({
  component: AppSettingsLayout,
})
