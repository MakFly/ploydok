// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import { BuildLogViewer } from "../../../../../../components/apps/BuildLogViewer"
import { useApp } from "../../../../../../lib/apps"

function AppLogsTab(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: app } = useApp(id)

  return (
    <BuildLogViewer
      appId={id}
      appName={app?.name}
      className="flex-1 min-h-0 rounded-none border-0"
    />
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/logs")({
  component: AppLogsTab,
})
