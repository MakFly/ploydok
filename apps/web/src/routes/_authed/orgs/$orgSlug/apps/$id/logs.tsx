// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppLogsTab } from "../../../../../../pages/apps/logs"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/logs")({
  component: AppLogsTab,
})
