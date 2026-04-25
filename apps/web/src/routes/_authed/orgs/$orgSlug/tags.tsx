// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/tags")({
  component: TagsPage,
})

function TagsPage(): React.JSX.Element {
  return (
    <ShellPage
      title="Tags"
      description="Étiquettes partagées pour grouper apps, databases et services par environnement, équipe ou criticité."
      eyebrow="Platform"
    >
      <ShellPanel
        title="Bientôt disponible"
        description="Les tags cross-resource (production, staging, billing, …) arrivent avec la refonte des filtres dashboard."
      >
        <p className="text-sm text-muted-foreground">
          En attendant, utilise la convention de nommage des apps/databases pour
          regrouper logiquement tes ressources.
        </p>
      </ShellPanel>
    </ShellPage>
  )
}
