// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { BuildLogViewer } from "../../../../components/apps/BuildLogViewer"
import { useApp } from "../../../../lib/apps"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/logs")({
  component: AppLogsTab,
})

// ---------------------------------------------------------------------------
// AppLogsTab — runtime container logs, fullwidth terminal layout
// ---------------------------------------------------------------------------

function AppLogsTab(): React.JSX.Element {
  const { id } = Route.useParams()
  const { data: app } = useApp(id)

  return (
    // h-[calc(100vh-8rem)] accounts for: top nav (56px) + page padding (~72px).
    // min-h-[500px] ensures usability on very short viewports.
    // The outer flex-col + flex-1 + min-h-0 chain lets BuildLogViewer fill all
    // remaining vertical space without causing the page to overflow.
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[500px]">
      {/* Slim page header — descriptive, stays above the terminal */}
      <div className="shrink-0 mb-3">
        <h2 className="text-sm font-semibold">Runtime logs</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Live stdout / stderr from the running container.
        </p>
      </div>

      {/* Terminal — grows to fill remaining vertical space */}
      <BuildLogViewer
        appId={id}
        appName={app?.name}
        className="flex-1 min-h-0"
      />
    </div>
  )
}
