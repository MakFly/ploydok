// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { WebhooksTab } from "../../../../../apps/$id/settings/webhooks";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings/webhooks")({
  component: WebhooksTab,
});
