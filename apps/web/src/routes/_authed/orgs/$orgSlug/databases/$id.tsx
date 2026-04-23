// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { DatabaseDetailPage } from "../../../../../pages/databases/detail"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/databases/$id")({
  component: DatabaseDetailPage,
})
