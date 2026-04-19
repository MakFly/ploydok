// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"
import { AppBar } from "../../../components/apps/AppBar"
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
// AppDetailLayout — unified AppBar + full-width main.
// Logs route skips padding so the terminal reaches the viewport edge.
// ---------------------------------------------------------------------------

function AppDetailLayout(): React.JSX.Element {
  const { id } = Route.useParams()
  const loaderData = Route.useLoaderData()
  const { data: app } = useApp(id)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const currentApp = app ?? loaderData.app
  const isLogsRoute = pathname === `/apps/${id}/logs`

  return (
    <div
      className={
        isLogsRoute
          ? "flex w-full flex-1 min-h-0 flex-col bg-background"
          : "flex w-full flex-1 flex-col bg-background"
      }
    >
      <AppBar app={currentApp} />

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
