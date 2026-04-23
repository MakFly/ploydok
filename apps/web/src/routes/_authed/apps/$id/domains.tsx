// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppDomainsTab } from "../../../../pages/apps/domains"

export const Route = createFileRoute("/_authed/apps/$id/domains")({
  component: AppDomainsTab,
})
