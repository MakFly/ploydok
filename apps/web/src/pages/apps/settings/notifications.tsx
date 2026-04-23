// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams } from "@tanstack/react-router"
import { ChannelList } from "../../../components/notifications/ChannelList"

export function AppNotificationsTab(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }

  return (
    <div className="flex w-full flex-col gap-6">
      <ChannelList appId={id} />
    </div>
  )
}
