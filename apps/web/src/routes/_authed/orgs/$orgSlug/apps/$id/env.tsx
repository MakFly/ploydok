// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import {
  RiAddLine,
  RiDatabase2Line,
  RiFileList3Line,
  RiTableLine,
  RiUploadLine,
} from "@remixicon/react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { SecretsTable } from "../../../../../../components/secrets/SecretsTable"
import { AddSecretDialog } from "../../../../../../components/secrets/AddSecretDialog"
import { RevealSecretDialog } from "../../../../../../components/secrets/RevealSecretDialog"
import { ImportEnvDialog } from "../../../../../../components/secrets/ImportEnvDialog"
import { LinkDatabaseDialog } from "../../../../../../components/databases/LinkDatabaseDialog"
import { useImportEnvContent, useSecrets } from "../../../../../../lib/secrets"
import { useApp } from "../../../../../../lib/apps"
import type {
  SecretMeta,
  SecretPhase,
  SecretScope,
} from "../../../../../../lib/secrets"

const SCOPES: SecretScope[] = ["shared", "prod", "preview", "dev"]
const PHASES: SecretPhase[] = ["runtime", "build", "both"]

const SCOPE_LABELS: Record<SecretScope, { label: string; hint: string }> = {
  shared: {
    label: "All environments",
    hint: "Injected into production, preview and development builds.",
  },
  prod: {
    label: "Production",
    hint: "Only injected when the app is deployed on the production branch.",
  },
  preview: {
    label: "Preview",
    hint: "Only injected into preview deployments (PR / feature branches).",
  },
  dev: {
    label: "Development",
    hint: "Only injected when running the app locally with the Ploydok CLI.",
  },
}

function AppEnvTab(): React.JSX.Element {
  const { id: appId } = useParams({ strict: false }) as { id: string }
  const [activeScope, setActiveScope] = React.useState<SecretScope>("shared")
  const [showAdd, setShowAdd] = React.useState(false)
  const [showImport, setShowImport] = React.useState(false)
  const [showLinkDb, setShowLinkDb] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<"normal" | "developer">(
    "normal"
  )
  const [revealTarget, setRevealTarget] = React.useState<{
    key: string
    scope: SecretScope
    phase: SecretPhase
  } | null>(null)

  const { data: app } = useApp(appId)
  const { data: secrets, isLoading, isError } = useSecrets(appId, activeScope)

  function handleReveal(key: string, scope: SecretScope, phase: SecretPhase) {
    setRevealTarget({ key, scope, phase })
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/40 bg-destructive/5 py-12 text-center">
        <p className="text-sm font-medium text-destructive">
          Failed to load secrets
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and try refreshing.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 px-4 py-6 md:px-8 md:py-8">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Encrypted secrets — AES-256-GCM at rest
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border bg-background p-0.5">
            <Button
              variant={viewMode === "normal" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("normal")}
              className="h-7 gap-1.5"
            >
              <RiTableLine className="size-3.5" />
              Normal
            </Button>
            <Button
              variant={viewMode === "developer" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("developer")}
              className="h-7 gap-1.5"
            >
              <RiFileList3Line className="size-3.5" />
              Developer
            </Button>
          </div>
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
          <Button
            size="sm"
            onClick={() => setShowAdd(true)}
            className="gap-1.5"
          >
            <RiAddLine className="size-3.5" />
            Add secret
          </Button>
        </div>
      </div>

      {/* Scope tabs */}
      <Tabs
        value={activeScope}
        onValueChange={(v) => setActiveScope(v as SecretScope)}
      >
        <TabsList>
          {SCOPES.map((s) => (
            <TabsTrigger key={s} value={s} title={SCOPE_LABELS[s].hint}>
              {SCOPE_LABELS[s].label}
            </TabsTrigger>
          ))}
        </TabsList>

        <p className="mt-2 text-xs text-muted-foreground">
          {SCOPE_LABELS[activeScope].hint}
        </p>

        {SCOPES.map((s) => (
          <TabsContent key={s} value={s}>
            {isLoading ? (
              <SecretsSkeleton />
            ) : viewMode === "developer" ? (
              <DeveloperEnvEditor
                appId={appId}
                scope={s}
                secrets={secrets ?? []}
              />
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

function DeveloperEnvEditor({
  appId,
  scope,
  secrets,
}: {
  appId: string
  scope: SecretScope
  secrets: SecretMeta[]
}): React.JSX.Element {
  const [content, setContent] = React.useState("")
  const [phase, setPhase] = React.useState<SecretPhase>("runtime")
  const { mutate: importContent, isPending } = useImportEnvContent(appId)
  const manualCount = secrets.filter((s) => s.managed_by === "manual").length
  const linkedCount = secrets.length - manualCount

  function handleImport(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return

    importContent(
      { content, scope, phase },
      {
        onSuccess: ({ imported }) => {
          toast.success(
            `Imported ${imported} variable${imported === 1 ? "" : "s"}`
          )
          setContent("")
        },
        onError: (err) => {
          toast.error(err.message)
        },
      }
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <form
        onSubmit={handleImport}
        className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-medium">Bulk import</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste .env lines. Prefixes like @prod @build override these
              defaults.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={phase}
              onValueChange={(value) => setPhase(value as SecretPhase)}
            >
              <SelectTrigger className="h-8 w-[132px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHASES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !content.trim()}
            >
              {isPending ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="min-h-[260px] resize-y font-mono text-xs"
          placeholder={[
            "APP_ENV=production",
            "APP_DEBUG=false",
            "@prod @runtime DATABASE_POOL=10",
            "# @phase build",
            "NPM_TOKEN=...",
          ].join("\n")}
        />
      </form>

      <aside className="rounded-lg border bg-muted/20 p-4">
        <h3 className="text-sm font-medium">Current scope</h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border bg-background p-2">
            <dt className="text-muted-foreground">Scope</dt>
            <dd className="mt-1 font-mono">{scope}</dd>
          </div>
          <div className="rounded-md border bg-background p-2">
            <dt className="text-muted-foreground">Keys</dt>
            <dd className="mt-1 font-mono">{secrets.length}</dd>
          </div>
          <div className="rounded-md border bg-background p-2">
            <dt className="text-muted-foreground">Manual</dt>
            <dd className="mt-1 font-mono">{manualCount}</dd>
          </div>
          <div className="rounded-md border bg-background p-2">
            <dt className="text-muted-foreground">Linked</dt>
            <dd className="mt-1 font-mono">{linkedCount}</dd>
          </div>
        </dl>
        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Existing keys
          </h4>
          <div className="max-h-48 overflow-auto rounded-md border bg-background">
            {secrets.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No keys yet.</p>
            ) : (
              <ul className="divide-y">
                {secrets.map((secret) => (
                  <li
                    key={`${secret.key}-${secret.scope}-${secret.phase}`}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="truncate font-mono text-xs">
                      {secret.key}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {secret.phase}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SecretsSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse overflow-hidden rounded-lg border border-border">
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
