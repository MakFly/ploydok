// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Shell } from "../../../../components/apps/Shell"

export const Route = createFileRoute("/_authed/apps/$id/shell")({
  component: ShellPage,
})

function ShellPage(): React.JSX.Element {
  const { id } = Route.useParams()

  return <Shell appId={id} />
}
