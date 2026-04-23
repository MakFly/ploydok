// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppNotificationsTab } from "../../../../../pages/apps/settings/notifications"

export const Route = createFileRoute("/_authed/apps/$id/settings/notifications")({
  component: AppNotificationsTab,
})
