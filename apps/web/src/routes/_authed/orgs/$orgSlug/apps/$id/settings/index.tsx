// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppSettingsGeneral } from "../../../../../../../pages/apps/settings/index"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings/")({
  component: AppSettingsGeneral,
})
