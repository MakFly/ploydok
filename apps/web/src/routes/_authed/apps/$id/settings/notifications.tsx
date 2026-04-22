// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ChannelList } from "../../../../../components/notifications/ChannelList"

export const Route = createFileRoute("/_authed/apps/$id/settings/notifications")({
  component: AppNotificationsTab,
})

function AppNotificationsTab(): React.JSX.Element {
  const { id } = Route.useParams()

  return (
    <div className="flex w-full flex-col gap-6">
      <ChannelList appId={id} />
    </div>
  )
}
