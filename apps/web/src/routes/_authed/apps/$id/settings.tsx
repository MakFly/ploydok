// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { AppStatusBadge } from "../../../../components/apps/AppStatusBadge"
import { useApp } from "../../../../lib/apps"

export const Route = createFileRoute("/_authed/apps/$id/settings")({
  component: AppSettingsLayout,
})

function AppSettingsLayout(): React.JSX.Element {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { data: app } = useApp(id)

  const tabs = [
    {
      value: "general",
      to: `/apps/${id}/settings`,
      label: "General",
      exact: true,
    },
    {
      value: "webhooks",
      to: `/apps/${id}/settings/webhooks`,
      label: "Webhooks",
      exact: false,
    },
    {
      value: "secret",
      to: `/apps/${id}/settings/webhook-secret`,
      label: "Secret",
      exact: false,
    },
    {
      value: "notifications",
      to: `/apps/${id}/settings/notifications`,
      label: "Notifications",
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
          void navigate({ to: next.to })
        }}
      >
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link to={tab.to}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  )
}
