// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "../../pages/dashboard"
import { redirectToDefaultOrganization } from "../../lib/auth-guards"

export const Route = createFileRoute("/_authed/dashboard")({
  beforeLoad: async () => redirectToDefaultOrganization(),
  component: DashboardPage,
})
