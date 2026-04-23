// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage } from "../../../../pages/apps/shell"

export const Route = createFileRoute("/_authed/apps/$id/shell")({
  component: ShellPage,
})
