// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  Outlet,
  useParams,
  useRouterState,
  createFileRoute,
} from "@tanstack/react-router"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../../../../../lib/organizations"

function AppSettingsLayout(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const currentOrgSlug = useCurrentOrganizationSlug()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const buildPath = (suffix: string): string =>
    currentOrgSlug
      ? organizationPath(currentOrgSlug, `apps/${id}/settings${suffix}`)
      : `/apps/${id}/settings${suffix}`

  const tabs = [
    { value: "general", to: buildPath(""), label: "General", exact: true },
    { value: "cdn", to: buildPath("/cdn"), label: "CDN", exact: false },
    {
      value: "protection",
      to: buildPath("/protection"),
      label: "Protection",
      exact: false,
    },
  ]

  const activeTab =
    tabs.find(({ to, exact }) =>
      exact ? pathname === to || pathname === `${to}/` : pathname.startsWith(to)
    )?.value ?? "general"

  return (
    <div className="w-full px-4 py-6 md:px-8 md:py-8">
      <Tabs value={activeTab} className="gap-6">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link to={tab.to as never}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  )
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/settings"
)({
  component: AppSettingsLayout,
})
