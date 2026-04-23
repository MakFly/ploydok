// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { ProtectionPage } from "../../../../../../../pages/apps/settings/protection"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings/protection")({
  component: ProtectionPage,
})
