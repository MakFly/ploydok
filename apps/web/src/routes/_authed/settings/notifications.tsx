// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage } from "../../../components/layout/AppShell"
import { ChannelList } from "../../../components/notifications/ChannelList"

export const Route = createFileRoute("/_authed/settings/notifications")({
  component: NotificationsPage,
})

function NotificationsPage(): React.JSX.Element {
  return (
    <ShellPage
      title="Notifications"
      description="Configurez les channels pour recevoir des alertes sur vos builds et déploiements."
    >
      <ChannelList />
    </ShellPage>
  )
}
