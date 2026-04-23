// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppsPage } from "../../../pages/apps/index"
import { redirectToDefaultOrganization } from "../../../lib/auth-guards"

export const Route = createFileRoute("/_authed/apps/")({
  beforeLoad: async () => redirectToDefaultOrganization(),
  component: AppsPage,
})
