// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Outlet, useParams, useRouterState } from "@tanstack/react-router"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { AppBar } from "../../../../../components/apps/AppBar"
import { useApp } from "../../../../../lib/apps"
import { useCurrentOrganizationSlug } from "../../../../../lib/organizations"
import { apiFetch } from "../../../../../lib/api"
import type { AppDetail } from "../../../../../lib/apps"
import type { OrganizationSummary } from "@ploydok/shared"

function AppDetailLayout(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: app } = useApp(id)
  const currentOrgSlug = useCurrentOrganizationSlug()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const currentApp = app
  const isLogsRoute =
    pathname === `/apps/${id}/logs` ||
    pathname === `/apps/${id}/shell` ||
    pathname === `/orgs/${currentOrgSlug}/apps/${id}/logs` ||
    pathname === `/orgs/${currentOrgSlug}/apps/${id}/shell`

  return (
    <div
      className={
        isLogsRoute
          ? "flex w-full flex-1 min-h-0 flex-col bg-background"
          : "flex w-full flex-1 flex-col bg-background"
      }
    >
      {currentApp ? <AppBar app={currentApp} /> : null}

      <main
        className={
          isLogsRoute
            ? "flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden"
            : "flex-1 min-w-0 px-4 py-4 md:px-6 md:py-6"
        }
      >
        <Outlet />
      </main>
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id")({
  loader: async ({ params }) => {
    const organizationData = await apiFetch<{ organization: OrganizationSummary }>(
      `/organizations/${params.orgSlug}`,
    )
    const { app } = await apiFetch<{ app: AppDetail; builds: Array<unknown> }>(
      `/apps/${params.id}`,
    )
    const data = { app }
    if (
      data.app.organizationId &&
      data.app.organizationId !== organizationData.organization.id
    ) {
      throw redirect({ href: `/orgs/${params.orgSlug}/apps`, replace: true })
    }
    return data
  },
  component: AppDetailLayout,
})
