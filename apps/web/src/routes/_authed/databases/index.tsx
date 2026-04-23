// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { DatabasesPage } from "../../../pages/databases/index"
import { redirectToDefaultOrganization } from "../../../lib/auth-guards"

export const Route = createFileRoute("/_authed/databases/")({
  beforeLoad: async () => redirectToDefaultOrganization(),
  component: DatabasesPage,
})
