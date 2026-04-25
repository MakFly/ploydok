// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/templates")({
  component: TemplatesPage,
})

function TemplatesPage(): React.JSX.Element {
  return (
    <ShellPage
      title="Templates"
      description="Stacks docker-compose multi-services prêtes à déployer."
      eyebrow="Workspace"
    >
      <ShellPanel
        title="Bientôt disponible"
        description="Les templates Compose (NextJS + Postgres + Redis, etc.) seront installables en un clic depuis ce catalogue."
      >
        <p className="text-sm text-muted-foreground">
          En attendant, le Marketplace permet d'installer des services unitaires
          (Postgres, Redis, …) un par un.
        </p>
      </ShellPanel>
    </ShellPage>
  )
}
