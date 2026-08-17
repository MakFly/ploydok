// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  useCreateGitHubAppFlow,
  useGitHubAppConfig,
  useGitHubCacheStatus,
  useInstallations,
  useResetGitHubApp,
  useRevokeInstallation,
  useSyncGitHubInstallations,
} from "../../../lib/github"
import { useMe } from "../../../lib/auth"
import { useGitProviderStatus } from "../../../lib/git-providers"
import { apiBaseUrl } from "../../../lib/api/base"
import { CachedReposPanel } from "./CachedReposPanel"
import { GitHubAppSetupCard, GitHubIcon } from "./GitHubAppSetupCard"
import { SyncProgressDialog } from "./SyncProgressDialog"
import { useSyncWithProgress } from "./useSyncWithProgress"
import type { AppInstallation } from "../../../lib/github"

export function GitHubPanel(): React.JSX.Element {
  const appParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("app")
      : null

  const { data: me, isLoading: meLoading } = useMe()
  const providerStatus = useGitProviderStatus()
  const isAdmin = me?.is_instance_admin === true
  const { data: appConfig, isLoading: appLoading } = useGitHubAppConfig({
    enabled: isAdmin,
  })
  const createApp = useCreateGitHubAppFlow("/settings/git-providers/github")
  const resetApp = useResetGitHubApp()
  const [resetError, setResetError] = React.useState<string | null>(null)
  const [appSuccess, setAppSuccess] = React.useState<boolean>(
    appParam === "created"
  )

  if (meLoading || providerStatus.isLoading) {
    return <GitHubStatusSkeleton />
  }

  if (!isAdmin) {
    return <GitHubUserConnection status={providerStatus.data?.github} />
  }

  const handleResetApp = async (): Promise<void> => {
    setResetError(null)
    try {
      await resetApp.mutateAsync()
      setAppSuccess(false)
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : "Failed to reset GitHub App"
      )
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">GitHub App</h2>
        <p className="text-sm text-muted-foreground">
          Create a GitHub App for your instance. Allows repo access across orgs
          without a personal token.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl bg-panel p-6">
        {appSuccess && (
          <p
            className="text-sm text-green-600 dark:text-green-400"
            role="status"
          >
            GitHub App configured successfully.
          </p>
        )}
        {appLoading ? (
          <GitHubStatusSkeleton />
        ) : appConfig?.configured ? (
          <GitHubAppConfiguredState
            name={appConfig.name!}
            slug={appConfig.slug!}
            isPending={resetApp.isPending}
            onReset={() => void handleResetApp()}
            error={resetError}
          />
        ) : (
          <GitHubAppSetupCard
            isPending={createApp.isPending}
            onCreate={() => void createApp.start()}
            onImported={() => setAppSuccess(true)}
            error={createApp.error}
          />
        )}
      </div>

      {appConfig?.configured && <InstallationsCard />}
    </div>
  )
}

function connectionHref(value?: string | null): string | null {
  if (!value) return null
  if (/^https?:\/\//.test(value)) return value
  return `${apiBaseUrl().replace(/\/$/, "")}/${value.replace(/^\//, "")}`
}

function GitHubUserConnection({
  status,
}: {
  status?: {
    configured: boolean
    connected: boolean
    install_url?: string | null
  }
}): React.JSX.Element {
  const installUrl = connectionHref(status?.install_url)

  return (
    <section className="rounded-2xl bg-panel p-6">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <GitHubIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {status?.connected
              ? "GitHub connected"
              : "Connect your GitHub account"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {status?.connected
              ? "This account can import repositories through the Ploydok GitHub App."
              : status?.configured
                ? "Install the instance GitHub App on an account or organization to import repositories."
                : "An instance administrator must configure the GitHub App before you can connect."}
          </p>
          {!status?.connected && status?.configured && installUrl ? (
            <Button asChild size="sm" className="mt-4">
              <a href={installUrl}>Install GitHub App</a>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function InstallationsCard(): React.JSX.Element {
  const { data, isLoading, isFetching, error, refetch } = useInstallations()
  const revoke = useRevokeInstallation()
  const [pendingId, setPendingId] = React.useState<number | null>(null)
  const [revokeError, setRevokeError] = React.useState<string | null>(null)
  const [justInstalled, setJustInstalled] = React.useState<{
    id: string
    action: string
    syncId: string | null
  } | null>(null)
  const [installError, setInstallError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const installationId = params.get("installation_id")
    const setupAction = params.get("setup_action")
    const installed = params.get("installed")
    const syncId = params.get("sync_id")
    const installErrorParam = params.get("install_error")

    if (installErrorParam) {
      const messages: Record<string, string> = {
        state_mismatch:
          "GitHub returned from installation with an invalid or expired state. Please retry.",
        missing_installation_id:
          "GitHub did not return an installation id. Please retry from the install button.",
        sync_failed:
          "GitHub installation completed, but Ploydok could not queue the repository sync. Please refresh or sync manually.",
      }
      setInstallError(
        messages[installErrorParam] ??
          "GitHub installation did not complete correctly. Please retry."
      )
      setJustInstalled(null)
    } else if (installationId && setupAction && installed === "1") {
      setJustInstalled({ id: installationId, action: setupAction, syncId })
      setInstallError(null)
      void refetch()
    } else if (!installationId && !setupAction) {
      return
    }

    params.delete("installation_id")
    params.delete("setup_action")
    params.delete("installed")
    params.delete("sync_id")
    params.delete("install_error")
    params.delete("state")
    const next = params.toString()
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${next ? `?${next}` : ""}`
    )

    const timer = setTimeout(() => setJustInstalled(null), 6_000)
    return () => clearTimeout(timer)
  }, [refetch])

  const handleStartInstall = (url: string): void => {
    if (typeof window === "undefined") return
    window.location.href = url
  }

  const handleRevoke = async (id: number, login: string): Promise<void> => {
    setRevokeError(null)
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Revoke Ploydok access from @${login}? You can reinstall from GitHub anytime.`
      )
    ) {
      return
    }
    setPendingId(id)
    try {
      await revoke.mutateAsync(id)
    } catch (err) {
      setRevokeError(
        err instanceof Error ? err.message : "Failed to revoke installation"
      )
    } finally {
      setPendingId(null)
    }
  }

  const installUrl = data?.installUrl ?? ""
  const hasInstallation =
    Boolean(justInstalled) || Boolean(data && data.installations.length > 0)

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Active installations</h2>
          <p className="text-sm text-muted-foreground">
            Accounts and organizations where the Ploydok GitHub App is
            installed. Revoking removes access to all repos from that account.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          loading={isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {justInstalled && (
        <p className="text-sm text-green-600 dark:text-green-400" role="status">
          GitHub App installation #{justInstalled.id}{" "}
          {justInstalled.action === "update" ? "updated" : "received"}. Your
          repositories are syncing below.
        </p>
      )}
      {installError && (
        <p className="text-sm text-destructive" role="alert">
          {installError}
        </p>
      )}

      <div className="space-y-4 rounded-2xl bg-panel p-6">
        {isLoading ? (
          <GitHubStatusSkeleton />
        ) : error ? (
          <p className="text-sm text-destructive" role="alert">
            Failed to load installations: {error.message}
          </p>
        ) : !data || data.installations.length === 0 ? (
          <InstallationsEmptyState
            installUrl={installUrl}
            onInstall={() => handleStartInstall(installUrl)}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.installations.map((inst) => (
              <InstallationRow
                key={inst.id}
                installation={inst}
                isPending={pendingId === inst.id}
                onRevoke={() => void handleRevoke(inst.id, inst.accountLogin)}
              />
            ))}
          </ul>
        )}
        {revokeError && (
          <p className="text-sm text-destructive" role="alert">
            {revokeError}
          </p>
        )}
        {data && data.installations.length > 0 && (
          <div className="border-t border-border pt-2">
            <button
              type="button"
              onClick={() => handleStartInstall(installUrl)}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              Add another account →
            </button>
          </div>
        )}
      </div>

      {hasInstallation && (
        <GitHubCacheSection
          autoSync={
            justInstalled?.syncId
              ? {
                  installationId: justInstalled.id,
                  syncId: justInstalled.syncId,
                }
              : null
          }
        />
      )}
    </>
  )
}

function GitHubCacheSection({
  autoSync,
}: {
  autoSync: { installationId: string; syncId: string } | null
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const sync = useSyncGitHubInstallations()
  const cache = useGitHubCacheStatus({})
  const progress = useSyncWithProgress()
  const [scope, setScope] = React.useState<"all" | string | undefined>(
    undefined
  )
  const autoSyncStartedRef = React.useRef<string | null>(null)
  const previousStatusRef = React.useRef(progress.status)

  React.useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = progress.status

    if (progress.status === "done" && previousStatus !== "done") {
      void cache.refetch()
      void queryClient.invalidateQueries({ queryKey: ["github", "repos"] })
      setScope(undefined)
    }
    if (progress.status === "error" || progress.status === "idle") {
      setScope(undefined)
    }
  }, [progress.status, cache.refetch, queryClient])

  React.useEffect(() => {
    if (!autoSync || autoSyncStartedRef.current === autoSync.syncId) return
    autoSyncStartedRef.current = autoSync.syncId
    setScope(autoSync.installationId)
    progress.begin(autoSync.syncId)
  }, [autoSync, progress.begin])

  async function startSync(opts: { installationId?: string }): Promise<void> {
    setScope(opts.installationId ?? "all")
    try {
      const res = await sync.mutateAsync(opts)
      progress.begin(res.syncId)
    } catch (err) {
      setScope(undefined)
      progress.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  return (
    <>
      <CachedReposPanel
        title="Cached repositories"
        description="Repos are served from a Postgres cache so the create-app picker opens instantly. Webhooks invalidate it on install / repo events; a background sync re-fills stale data."
        entries={cache.data?.installations ?? []}
        isLoading={cache.isLoading}
        isError={cache.isError}
        errorMessage={cache.error?.message}
        isSyncing={sync.isPending || progress.status === "running"}
        syncingScope={progress.status === "running" ? scope : undefined}
        onSyncOne={(installationId) => startSync({ installationId })}
        onSyncAll={() => startSync({})}
        emptyState={
          <p className="text-sm text-muted-foreground">
            No installation cached yet. Click <strong>Sync now</strong> to
            import your GitHub installations and their repositories.
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
        providerLabel="GitHub"
      />
    </>
  )
}

function InstallationRow({
  installation,
  isPending,
  onRevoke,
}: {
  installation: AppInstallation
  isPending: boolean
  onRevoke: () => void
}): React.JSX.Element {
  const count = installation.repositoryCount
  const countLabel =
    count === null
      ? "unknown"
      : installation.repositorySelection === "all"
        ? `all repositories`
        : `${count} ${count === 1 ? "repository" : "repositories"}`

  return (
    <li className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
      {installation.avatarUrl ? (
        <img
          src={installation.avatarUrl}
          alt={installation.accountLogin}
          className="size-10 rounded-full"
        />
      ) : (
        <div className="size-10 rounded-full bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          @{installation.accountLogin}
          <span className="ml-2 text-xs text-muted-foreground">
            {installation.accountType}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {countLabel}
          {installation.suspendedAt && (
            <span className="ml-2 text-destructive">· suspended</span>
          )}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRevoke}
        loading={isPending}
      >
        {isPending ? "Revoking..." : "Revoke"}
      </Button>
    </li>
  )
}

function InstallationsEmptyState({
  installUrl,
  onInstall,
}: {
  installUrl: string
  onInstall: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        The GitHub App is configured but has no repository access yet. Install
        it on a GitHub account or organization to enable repository import.
      </p>
      {installUrl && (
        <Button size="sm" onClick={onInstall}>
          Install on GitHub
        </Button>
      )}
    </div>
  )
}

function GitHubStatusSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-4"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="size-10 rounded-full skeleton-surface" />
      <div className="space-y-2">
        <div className="h-4 w-32 rounded skeleton-surface" />
        <div className="h-3 w-48 rounded skeleton-surface" />
      </div>
    </div>
  )
}

interface GitHubAppConfiguredStateProps {
  name: string
  slug: string
  isPending: boolean
  onReset: () => void
  error: string | null
}

function GitHubAppConfiguredState({
  name,
  slug,
  isPending,
  onReset,
  error,
}: GitHubAppConfiguredStateProps): React.JSX.Element {
  const handleResetClick = (): void => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Uninstall ${name} from every GitHub account and remove the local Ploydok configuration? This cannot be undone from Ploydok.`
      )
      if (!confirmed) return
    }
    onReset()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <GitHubIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">
            <span className="font-semibold">{name}</span>{" "}
            <span className="text-xs text-muted-foreground">({slug})</span>
          </p>
          <p className="text-xs text-muted-foreground">
            GitHub App registered. Repository access is managed from the active
            installations below.
          </p>
        </div>
        <div className="ml-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            <span
              className="size-1.5 rounded-full bg-current"
              aria-hidden="true"
            />
            Configured
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleResetClick}
          loading={isPending}
        >
          {isPending ? "Uninstalling..." : "Reset App"}
        </Button>
      </div>
    </div>
  )
}
