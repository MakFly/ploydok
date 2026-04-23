// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { AppNotificationsTab } from "../../../../../apps/$id/settings/notifications";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings/notifications")({
  component: AppNotificationsTab,
});
