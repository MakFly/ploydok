// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Outlet, useParams, useRouterState } from "@tanstack/react-router"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { AppBar } from "../../../../../components/apps/AppBar"
import { normalizeAppDetail, useApp } from "../../../../../lib/apps"
import { useCurrentOrganizationSlug } from "../../../../../lib/organizations"
import { apiFetch } from "../../../../../lib/api"
import type { RawAppDetail } from "../../../../../lib/apps"
import type { Build, OrganizationSummary } from "@ploydok/shared"

function AppDetailLayout(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const loaderData = Route.useLoaderData()
  const { data: app } = useApp(id, { initialData: loaderData.app })
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
          ? "flex min-h-0 w-full flex-1 flex-col bg-background"
          : "flex w-full flex-1 flex-col bg-background"
      }
    >
      {currentApp ? <AppBar app={currentApp} /> : null}

      <main
        className={
          isLogsRoute
            ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            : "min-w-0 flex-1"
        }
      >
        <Outlet />
      </main>
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id")({
  loader: async ({ params }) => {
    const [organizationData, appData] = await Promise.all([
      apiFetch<{ organization: OrganizationSummary }>(
        `/organizations/${params.orgSlug}`
      ),
      apiFetch<{ app: RawAppDetail; builds: Array<Build> }>(
        `/apps/${params.id}`
      ),
    ])
    const app = {
      ...normalizeAppDetail(appData.app),
      builds: appData.builds,
    }
    if (
      app.organizationId &&
      app.organizationId !== organizationData.organization.id
    ) {
      throw redirect({ href: `/orgs/${params.orgSlug}/apps`, replace: true })
    }
    return { app }
  },
  component: AppDetailLayout,
})
