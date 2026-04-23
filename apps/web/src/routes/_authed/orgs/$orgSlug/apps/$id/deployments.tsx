// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { AppDeploymentsTab } from "../../../../apps/$id/deployments";

interface DeploymentsSearch {
  build?: string;
}

function validateDeploymentsSearch(search: Record<string, unknown>): DeploymentsSearch {
  return {
    build: typeof search["build"] === "string" ? search["build"] : undefined,
  };
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/deployments")({
  validateSearch: validateDeploymentsSearch,
  component: AppDeploymentsTab,
});
