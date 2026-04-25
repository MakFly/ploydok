// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/deployments")({
  component: DeploymentsPage,
})

function DeploymentsPage(): React.JSX.Element {
  return (
    <ShellPage
      title="Deployments"
      description="Vue cross-app de tous les déploiements de ce workspace."
      eyebrow="Workspace"
    >
      <ShellPanel
        title="Bientôt disponible"
        description="L'historique de déploiements consolidé par workspace arrive dans un prochain sprint."
      >
        <p className="text-sm text-muted-foreground">
          En attendant, ouvre une application puis l'onglet Deployments pour
          voir son historique individuel.
        </p>
      </ShellPanel>
    </ShellPage>
  )
}
