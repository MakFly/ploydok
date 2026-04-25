// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/shared-env")({
  component: SharedEnvPage,
})

function SharedEnvPage(): React.JSX.Element {
  const { orgSlug } = Route.useParams()
  return (
    <ShellPage
      title="Shared env vars"
      description="Variables d'environnement partagées entre toutes les apps du workspace. Mergées à deploy (les vars app prennent le dessus)."
      eyebrow="Workspace"
    >
      <ShellPanel
        title="Variables"
        description="UI détaillée à venir — l'API est déjà prête."
      >
        <p className="text-sm text-muted-foreground">
          API :{" "}
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            PUT /orgs/{orgSlug}/shared-env
          </code>{" "}
          avec{" "}
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            {"{ vars: [{ key, value, is_secret }] }"}
          </code>
          .
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Les variables sont chiffrées via MASTER_KEY côté serveur, déchiffrées
          et injectées au runtime de chaque deploy. Conflit clé : la var app
          écrase la var project.
        </p>
      </ShellPanel>
    </ShellPage>
  )
}
