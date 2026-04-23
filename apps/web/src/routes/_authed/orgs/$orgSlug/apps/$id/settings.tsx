// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { AppSettingsLayout } from "../../../../apps/$id/settings";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings")({
  component: AppSettingsLayout,
});
