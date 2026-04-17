// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Outlet, createFileRoute } from "@tanstack/react-router"
import { AppHeader } from "../../../components/apps/AppHeader"
import { AppSidebar } from "../../../components/apps/AppSidebar"
import { apiFetch } from "../../../lib/api"
import { useApp } from "../../../lib/apps"
import type { AppDetail } from "../../../lib/apps"

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id")({
  loader: async ({ params }): Promise<{ app: AppDetail }> => {
    const { app } = await apiFetch<{ app: AppDetail; builds: Array<unknown> }>(
      `/apps/${params.id}`,
    )
    return { app }
  },
  component: AppDetailLayout,
})

// ---------------------------------------------------------------------------
// AppDetailLayout — Layout B "Grafana-style"
//
// Structure:
//   [AppHeader — sticky h-14 fullwidth]
//   [AppSidebar w-56 sticky top-14] | [main flex-1 min-w-0]
//
// AppSidebar is hidden on mobile (< md). Mobile sub-nav drawer is deferred
// to a future sprint (known UX gap).
// ---------------------------------------------------------------------------

function AppDetailLayout(): React.JSX.Element {
  const { id } = Route.useParams()
  const loaderData = Route.useLoaderData()
  const { data: app } = useApp(id)

  // Prefer live data from query, fall back to loader snapshot
  const currentApp = app ?? loaderData.app

  return (
    <div className="flex flex-col w-full min-h-screen">
      <AppHeader app={currentApp} />

      <div className="flex flex-1 w-full">
        <AppSidebar app={currentApp} appId={id} />

        {/* min-w-0 prevents flex children (tables, log consoles) from
            overflowing the parent when content is wider than the viewport */}
        <main className="flex-1 min-w-0 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
