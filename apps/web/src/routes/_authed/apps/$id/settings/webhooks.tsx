// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { WebhooksTab } from "../../../../../pages/apps/settings/webhooks"

export const Route = createFileRoute("/_authed/apps/$id/settings/webhooks")({
  component: WebhooksTab,
})
