// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleFill,
  RiGitlabFill,
  RiLink,
  RiLoopRightLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import {
  gitlabConnectUrl,
  useDeleteGitLabConfig,
  useDisconnectGitLab,
  useGitLabCacheStatus,
  useGitLabConfig,
  useSaveGitLabConfig,
  useSyncGitLabInstallations,
} from "../../../lib/gitlab"
import { useMe } from "../../../lib/auth"
import { useGitProviderStatus } from "../../../lib/git-providers"
import { CachedReposPanel } from "./CachedReposPanel"
import { GitLabConfigForm, GitLabSetupHelp } from "./GitLabConfigForm"
import { SyncProgressDialog } from "./SyncProgressDialog"
import { useSyncWithProgress } from "./useSyncWithProgress"

export function GitLabPanel(): React.JSX.Element {
  const { data: me } = useMe()
  const providerStatus = useGitProviderStatus()
  const { data: config, isLoading } = useGitLabConfig()
  const save = useSaveGitLabConfig()
  const del = useDeleteGitLabConfig()
  const disconnect = useDisconnectGitLab()

  const justConnected =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("connected") === "1"

  const configured = Boolean(
    providerStatus.data?.gitlab.configured ?? config?.configured
  )
  const connected = Boolean(providerStatus.data?.gitlab.connected)
  const isAdmin = me?.is_instance_admin === true

  return (
    <div className="space-y-6">
      {justConnected ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <RiCheckboxCircleFill className="size-4" />
          <span>
            Connexion GitLab réussie. Tu peux maintenant lister tes projets.
          </span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl rounded-xl bg-panel p-5 text-xs text-muted-foreground">
          Chargement…
        </div>
      ) : configured ? (
        <ConfiguredState
          config={config!}
          onReset={() => del.mutate()}
          onDisconnect={() => disconnect.mutate()}
          resetPending={del.isPending}
          disconnectPending={disconnect.isPending}
          connected={connected}
          isAdmin={isAdmin}
        />
      ) : isAdmin ? (
        <GitLabConfigForm
          onSave={async (values) => {
            await save.mutateAsync(values)
          }}
          pending={save.isPending}
        />
      ) : (
        <section className="rounded-2xl bg-panel p-5 text-sm text-muted-foreground">
          An instance administrator must configure the GitLab OAuth app before
          you can connect your account.
        </section>
      )}

      {isAdmin ? <GitLabSetupHelp callbackUrl={config?.callback_url} /> : null}

      {connected ? <GitLabCacheSection /> : null}
    </div>
  )
}

function GitLabCacheSection(): React.JSX.Element {
  const sync = useSyncGitLabInstallations()
  const cache = useGitLabCacheStatus({})
  const entries = cache.data?.installation ? [cache.data.installation] : []
  const progress = useSyncWithProgress()

  React.useEffect(() => {
    if (progress.status === "done") void cache.refetch()
  }, [progress.status, cache])

  async function startSync(): Promise<void> {
    try {
      const res = await sync.mutateAsync()
      progress.begin(res.syncId)
    } catch (err) {
      progress.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  return (
    <>
      <CachedReposPanel
        title="Cached repositories"
        description="Repos are served from a Postgres cache so the create-app picker opens instantly. Use Sync if you just added a project on GitLab and don't see it yet."
        entries={entries}
        isLoading={cache.isLoading}
        isError={cache.isError}
        errorMessage={cache.error?.message}
        isSyncing={sync.isPending || progress.status === "running"}
        syncingScope={progress.status === "running" ? "all" : undefined}
        onSyncOne={() => startSync()}
        onSyncAll={() => startSync()}
        emptyState={
          <p className="text-sm text-muted-foreground">
            No GitLab projects cached yet. Click <strong>Sync now</strong> to
            import your projects.
          </p>
        }
      />
      <SyncProgressDialog
        open={progress.open}
        onClose={progress.close}
        status={progress.status}
        startedAt={progress.startedAt}
        importedCount={progress.importedCount}
        totalCount={progress.totalCount}
        errorMessage={progress.errorMessage}
        providerLabel="GitLab"
      />
    </>
  )
}

function ConfiguredState({
  config,
  onReset,
  onDisconnect,
  resetPending,
  disconnectPending,
  connected,
  isAdmin,
}: {
  config: { instance_url?: string; client_id?: string }
  onReset: () => void
  onDisconnect: () => void
  resetPending: boolean
  disconnectPending: boolean
  connected: boolean
  isAdmin: boolean
}): React.JSX.Element {
  return (
    <section className="space-y-4 rounded-2xl rounded-xl bg-panel p-5">
      <header className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
          <RiGitlabFill className="size-5 text-[#fc6d26]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-medium">
              GitLab configuré
            </h2>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
              <RiCheckboxCircleFill className="size-3" />
              {connected ? "Connected" : "Configured"}
            </span>
          </div>
          <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground">
            {config.instance_url}
          </p>
        </div>
      </header>

      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Client ID
          </dt>
          <dd className="mt-0.5 font-mono text-xs">
            {config.client_id ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Instance
          </dt>
          <dd className="mt-0.5 truncate font-mono text-xs">
            {config.instance_url ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={gitlabConnectUrl()}>
            <RiLink className="size-3.5" />
            Connecter mon compte
          </a>
        </Button>
        {connected ? (
          <Button
            variant="outline"
            onClick={onDisconnect}
            loading={disconnectPending}
          >
            {!disconnectPending && <RiLoopRightLine className="size-3.5" />}
            {disconnectPending ? "Déconnexion…" : "Révoquer mes tokens"}
          </Button>
        ) : null}
        {isAdmin ? (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onReset}
            loading={resetPending}
          >
            {resetPending ? "Suppression…" : "Supprimer la configuration"}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
