// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "../../../../pages/dashboard"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/dashboard")({
  component: DashboardPage,
})
