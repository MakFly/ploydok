// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import { RiUploadLine, RiAddLine, RiDatabase2Line } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { SecretsTable } from "../../../../../../components/secrets/SecretsTable"
import { AddSecretDialog } from "../../../../../../components/secrets/AddSecretDialog"
import { RevealSecretDialog } from "../../../../../../components/secrets/RevealSecretDialog"
import { ImportEnvDialog } from "../../../../../../components/secrets/ImportEnvDialog"
import { LinkDatabaseDialog } from "../../../../../../components/databases/LinkDatabaseDialog"
import { useSecrets } from "../../../../../../lib/secrets"
import { useApp } from "../../../../../../lib/apps"
import type { SecretPhase, SecretScope } from "../../../../../../lib/secrets"

const SCOPES: SecretScope[] = ["shared", "prod", "preview", "dev"]

function AppEnvTab(): React.JSX.Element {
  const { id: appId } = useParams({ strict: false }) as { id: string }
  const [activeScope, setActiveScope] = React.useState<SecretScope>("shared")
  const [showAdd, setShowAdd] = React.useState(false)
  const [showImport, setShowImport] = React.useState(false)
  const [showLinkDb, setShowLinkDb] = React.useState(false)
  const [revealTarget, setRevealTarget] = React.useState<{ key: string; scope: SecretScope; phase: SecretPhase } | null>(null)

  const { data: app } = useApp(appId)
  const { data: secrets, isLoading, isError } = useSecrets(appId, activeScope)

  function handleReveal(key: string, scope: SecretScope, phase: SecretPhase) {
    setRevealTarget({ key, scope, phase })
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/40 bg-destructive/5 py-12 text-center">
        <p className="text-sm font-medium text-destructive">Failed to load secrets</p>
        <p className="mt-1 text-xs text-muted-foreground">Check your connection and try refreshing.</p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 px-4 py-6 md:px-6 md:py-8">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Encrypted secrets — AES-256-GCM at rest</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImport(true)}
            className="gap-1.5"
          >
            <RiUploadLine className="size-3.5" />
            Import .env
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLinkDb(true)}
            className="gap-1.5"
          >
            <RiDatabase2Line className="size-3.5" />
            Link database
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
            <RiAddLine className="size-3.5" />
            Add secret
          </Button>
        </div>
      </div>

      {/* Scope tabs */}
      <Tabs value={activeScope} onValueChange={(v) => setActiveScope(v as SecretScope)}>
        <TabsList>
          {SCOPES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s}
            </TabsTrigger>
          ))}
        </TabsList>

        {SCOPES.map((s) => (
          <TabsContent key={s} value={s}>
            {isLoading ? (
              <SecretsSkeleton />
            ) : (
              <SecretsTable
                appId={appId}
                scope={s}
                secrets={secrets ?? []}
                onReveal={handleReveal}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Dialogs */}
      <AddSecretDialog
        appId={appId}
        open={showAdd}
        defaultScope={activeScope}
        onOpenChange={setShowAdd}
      />

      <ImportEnvDialog
        appId={appId}
        open={showImport}
        defaultScope={activeScope}
        onOpenChange={setShowImport}
      />

      <RevealSecretDialog
        appId={appId}
        secretKey={revealTarget?.key ?? null}
        scope={revealTarget?.scope ?? null}
        phase={revealTarget?.phase ?? null}
        onClose={() => setRevealTarget(null)}
      />

      {app?.projectId && (
        <LinkDatabaseDialog
          open={showLinkDb}
          appId={appId}
          projectId={app.projectId}
          onClose={() => setShowLinkDb(false)}
        />
      )}
    </div>
  )
}

function SecretsSkeleton(): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border animate-pulse">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5" />
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="ml-auto flex gap-2">
              <div className="size-7 rounded bg-muted" />
              <div className="size-7 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/env")({
  component: AppEnvTab,
})
