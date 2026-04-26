// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, notFound } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/event-webhooks")({
  beforeLoad: () => {
    throw notFound()
  },
})
