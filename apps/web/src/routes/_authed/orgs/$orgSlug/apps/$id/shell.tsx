// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import { Shell } from "../../../../../../components/apps/Shell"

function ShellPage(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }

  return <Shell appId={id} />
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/shell")({
  component: ShellPage,
})
