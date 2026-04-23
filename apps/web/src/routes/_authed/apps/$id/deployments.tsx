// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppDeploymentsTab } from "../../../../pages/apps/deployments"

interface DeploymentsSearch {
  build?: string
}

function validateDeploymentsSearch(search: Record<string, unknown>): DeploymentsSearch {
  return {
    build: typeof search["build"] === "string" ? search["build"] : undefined,
  }
}

export const Route = createFileRoute("/_authed/apps/$id/deployments")({
  validateSearch: validateDeploymentsSearch,
  component: AppDeploymentsTab,
})
