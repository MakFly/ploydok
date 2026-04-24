// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  useCreateGitHubApp,
  useGitHubAppConfig,
  useGitHubCacheStatus,
  useInstallations,
  useResetGitHubApp,
  useRevokeInstallation,
  useSyncGitHubInstallations,
} from "../../../lib/github"
import type { AppInstallation } from "../../../lib/github"
import { CachedReposPanel } from "./CachedReposPanel"
import { SyncProgressDialog } from "./SyncProgressDialog"
import { useSyncWithProgress } from "./useSyncWithProgress"

export function GitHubPanel(): React.JSX.Element {
  const appParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("app")
      : null

  const { data: appConfig, isLoading: appLoading } = useGitHubAppConfig()
  const createApp = useCreateGitHubApp()
  const resetApp = useResetGitHubApp()
  const [resetError, setResetError] = React.useState<string | null>(null)
  const [appSuccess, setAppSuccess] = React.useState<boolean>(appParam === "created")

  const handleCreateApp = async (): Promise<void> => {
    try {
      const data = await createApp.mutateAsync()
      const form = document.createElement("form")
      form.method = "POST"
      form.action = data.post_url
      form.style.display = "none"

      const input = document.createElement("input")
      input.type = "hidden"
      input.name = "manifest"
      input.value = JSON.stringify(data.manifest)
      form.appendChild(input)

      document.body.appendChild(form)
      form.submit()
    } catch {
      // createApp.error will be set by react-query
    }
  }

  const handleResetApp = async (): Promise<void> => {
    setResetError(null)
    try {
      await resetApp.mutateAsync()
      setAppSuccess(false)
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset GitHub App")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">GitHub App</h2>
        <p className="text-sm text-muted-foreground">
          Create a GitHub App for your instance. Allows repo access across orgs without a personal token.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        {appSuccess && (
          <p className="text-sm text-green-600 dark:text-green-400" role="status">
            GitHub App created successfully.
          </p>
        )}
        {appLoading ? (
          <GitHubStatusSkeleton />
        ) : appConfig?.configured ? (
          <GitHubAppConfiguredState
            name={appConfig.name!}
            slug={appConfig.slug!}
            installUrl={appConfig.install_url!}
            isPending={resetApp.isPending}
            onReset={() => void handleResetApp()}
            error={resetError}
          />
        ) : (
          <GitHubAppUnconfiguredState
            isPending={createApp.isPending}
            onCreate={() => void handleCreateApp()}
            error={createApp.error?.message ?? null}
          />
        )}
      </div>

      {appConfig?.configured && <InstallationsCard />}
    </div>
  )
}

function InstallationsCard(): React.JSX.Element {
  const { data, isLoading, isFetching, error, refetch } = useInstallations()
  const revoke = useRevokeInstallation()
  const [pendingId, setPendingId] = React.useState<number | null>(null)
  const [revokeError, setRevokeError] = React.useState<string | null>(null)
  const [justInstalledId, setJustInstalledId] = React.useState<string | null>(null)
  const [installError, setInstallError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const installationId = params.get("installation_id")
    const setupAction = params.get("setup_action")
    const installed = params.get("installed")
    const installErrorParam = params.get("install_error")

    if (installErrorParam) {
      setInstallError(
        installErrorParam === "state_mismatch"
          ? "GitHub returned from installation with an invalid or expired state. Please retry."
          : "GitHub installation did not complete correctly. Please retry.",
      )
    }

    if (!installationId || !setupAction) {
      if (!installErrorParam) return
      params.delete("install_error")
      const next = params.toString()
      window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`)
      return
    }

    setJustInstalledId(installationId)
    setInstallError(null)
    if (installed === "1") void refetch()

    params.delete("installation_id")
    params.delete("setup_action")
    params.delete("installed")
    params.delete("install_error")
    params.delete("state")
    const next = params.toString()
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`)

    const timer = setTimeout(() => setJustInstalledId(null), 6_000)
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
      !window.confirm(`Revoke Ploydok access from @${login}? You can reinstall from GitHub anytime.`)
    ) {
      return
    }
    setPendingId(id)
    try {
      await revoke.mutateAsync(id)
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Failed to revoke installation")
    } finally {
      setPendingId(null)
    }
  }

  const installUrl = data?.installUrl ?? ""

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Active installations</h2>
          <p className="text-sm text-muted-foreground">
            Accounts and organizations where the Ploydok GitHub App is installed. Revoking removes access to all repos from that account.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {justInstalledId && (
        <p className="text-sm text-green-600 dark:text-green-400" role="status">
          GitHub App installation #{justInstalledId} received. Your repositories are now accessible below.
        </p>
      )}
      {installError && (
        <p className="text-sm text-destructive" role="alert">
          {installError}
        </p>
      )}

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
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
          <p className="text-sm text-destructive" role="alert">{revokeError}</p>
        )}
        {data && data.installations.length > 0 && (
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => handleStartInstall(installUrl)}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              Install on another account →
            </button>
          </div>
        )}
      </div>

      <GitHubCacheSection />
    </>
  )
}

function GitHubCacheSection(): React.JSX.Element {
  const sync = useSyncGitHubInstallations()
  const entries = React.useMemo(() => [], [])
  const cache = useGitHubCacheStatus({
    autoRefresh: sync.isPending,
  })
  const liveEntries = cache.data?.installations ?? entries
  const [scopeId, setScopeId] = React.useState<string | undefined>(undefined)
  const progress = useSyncWithProgress({
    entries: liveEntries,
    isMutationError: sync.isError,
    mutationErrorMessage: sync.error?.message,
    scopeId,
  })

  React.useEffect(() => {
    if (progress.status === "running") {
      void cache.refetch()
    }
  }, [progress.status, cache])

  async function startSync(opts: { installationId?: string }): Promise<void> {
    setScopeId(opts.installationId)
    progress.begin()
    try {
      await sync.mutateAsync(opts)
    } catch (err) {
      progress.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  return (
    <>
      <CachedReposPanel
        title="Cached repositories"
        description="Repos are served from a Postgres cache so the create-app picker opens instantly. Webhooks invalidate it on install / repo events; a background sync re-fills stale data."
        entries={liveEntries}
        isLoading={cache.isLoading}
        isError={cache.isError}
        errorMessage={cache.error?.message}
        isSyncing={sync.isPending || progress.status === "running"}
        onSyncOne={(installationId) => startSync({ installationId })}
        onSyncAll={() => startSync({})}
        emptyState={
          <p className="text-sm text-muted-foreground">
            No installation cached yet. Click <strong>Sync now</strong> to import your
            GitHub installations and their repositories.
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
        <p className="text-sm font-medium truncate">
          @{installation.accountLogin}
          <span className="ml-2 text-xs text-muted-foreground">{installation.accountType}</span>
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {countLabel}
          {installation.suspendedAt && <span className="ml-2 text-destructive">· suspended</span>}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRevoke}
        disabled={isPending}
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
        The GitHub App isn't installed on any account yet. Install it to grant Ploydok access to your repositories.
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
    <div className="flex items-center gap-4 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="size-10 rounded-full bg-muted" />
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-3 w-48 rounded bg-muted" />
      </div>
    </div>
  )
}

interface GitHubAppUnconfiguredStateProps {
  isPending: boolean
  onCreate: () => void
  error: string | null
}

function GitHubAppUnconfiguredState({
  isPending,
  onCreate,
  error,
}: GitHubAppUnconfiguredStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <GitHubIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">No GitHub App configured</p>
          <p className="text-xs text-muted-foreground">
            Create a GitHub App in one click. Ploydok will register it automatically.
          </p>
        </div>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}
      <Button onClick={onCreate} size="sm" disabled={isPending}>
        {isPending ? "Redirecting to GitHub..." : "Create GitHub App"}
      </Button>
    </div>
  )
}

interface GitHubAppConfiguredStateProps {
  name: string
  slug: string
  installUrl: string
  isPending: boolean
  onReset: () => void
  error: string | null
}

function GitHubAppConfiguredState({
  name,
  slug,
  installUrl,
  isPending,
  onReset,
  error,
}: GitHubAppConfiguredStateProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <GitHubIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">
            <span className="font-semibold">{name}</span>{" "}
            <span className="text-muted-foreground text-xs">({slug})</span>
          </p>
          <p className="text-xs text-muted-foreground">
            GitHub App registered. Install it on your account or organization.
          </p>
        </div>
        <div className="ml-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            Configured
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button asChild size="sm" variant="outline">
          <a href={installUrl} target="_blank" rel="noopener noreferrer">
            Install on GitHub
          </a>
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onReset}
          disabled={isPending}
        >
          {isPending ? "Resetting..." : "Reset App"}
        </Button>
      </div>
    </div>
  )
}

function GitHubIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}
