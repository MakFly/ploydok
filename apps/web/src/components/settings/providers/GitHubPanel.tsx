// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  useCreateGitHubAppFlow,
  useForgetLocalGitHubApp,
  useGitHubAppConfig,
  useGitHubAppCredentialsStatus,
  useGitHubCacheStatus,
  useInstallations,
  useRemoveGitHubInstallation,
  useResetGitHubApp,
  useSyncGitHubInstallations,
} from "../../../lib/github"
import { useMe } from "../../../lib/auth"
import { useGitProviderStatus } from "../../../lib/git-providers"
import { apiBaseUrl } from "../../../lib/api/base"
import { CachedReposPanel } from "./CachedReposPanel"
import { GitHubAppSetupCard, GitHubIcon } from "./GitHubAppSetupCard"
import { SyncProgressDialog } from "./SyncProgressDialog"
import { useSyncWithProgress } from "./useSyncWithProgress"
import type {
  AppInstallation,
  GitHubAppCredentialsStatus,
} from "../../../lib/github"

type CredentialsStatus = GitHubAppCredentialsStatus["status"] | undefined

const responsiveDialogActionClassName =
  "h-auto min-h-[38px] w-full whitespace-normal py-2 sm:h-[38px] sm:w-auto sm:whitespace-nowrap sm:py-0"

export function shouldOpenGitHubCredentialsDialog(
  status: CredentialsStatus,
  dismissed: boolean
): boolean {
  return status === "unreadable" && !dismissed
}

export function canLoadGitHubInstallations(
  configured: boolean,
  status: CredentialsStatus
): boolean {
  return configured && status === "readable"
}

export function GitHubCredentialsRecovery({
  unreadable,
  onImported,
}: {
  unreadable: boolean
  onImported: () => void
}): React.JSX.Element | null {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogDismissed, setDialogDismissed] = React.useState(false)
  const [reconnecting, setReconnecting] = React.useState(false)
  const [forgetDialogOpen, setForgetDialogOpen] = React.useState(false)
  const forgetLocalApp = useForgetLocalGitHubApp()

  React.useEffect(() => {
    if (
      shouldOpenGitHubCredentialsDialog(
        unreadable ? "unreadable" : "readable",
        dialogDismissed
      )
    ) {
      setDialogOpen(true)
    }
    if (!unreadable) {
      setDialogOpen(false)
      setDialogDismissed(false)
      setReconnecting(false)
      setForgetDialogOpen(false)
    }
  }, [dialogDismissed, unreadable])

  const handleForgetLocalApp = async (): Promise<void> => {
    try {
      await forgetLocalApp.mutateAsync()
      setForgetDialogOpen(false)
    } catch {
      // The mutation exposes its structured ApiError in the confirmation.
    }
  }

  if (!unreadable) return null

  return (
    <>
      <div
        className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
        role="alert"
      >
        <div>
          <p className="text-sm font-medium text-destructive">
            GitHub App credentials are unreadable
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            The stored private key cannot be decrypted with the current instance
            key. Repository access is paused until the existing App is
            reconnected.
          </p>
        </div>
        {!reconnecting && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReconnecting(true)}
            >
              Reconnect GitHub App
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                forgetLocalApp.reset()
                setForgetDialogOpen(true)
              }}
            >
              Reset local configuration
            </Button>
          </div>
        )}
        {reconnecting && (
          <GitHubAppSetupCard
            mode="reconnect"
            isPending={false}
            onCreate={() => undefined}
            onImported={() => {
              setReconnecting(false)
              onImported()
            }}
            error={null}
          />
        )}
      </div>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setDialogDismissed(true)
        }}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              GitHub App credentials need attention
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ploydok can no longer decrypt the stored GitHub App private key.
              No GitHub installation was changed. Reconnect the existing App to
              restore repository access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={responsiveDialogActionClassName}>
              Later
            </AlertDialogCancel>
            <Button
              className={responsiveDialogActionClassName}
              variant="destructive"
              onClick={() => {
                setDialogOpen(false)
                setDialogDismissed(true)
                forgetLocalApp.reset()
                setForgetDialogOpen(true)
              }}
            >
              Reset local configuration
            </Button>
            <AlertDialogAction
              className={responsiveDialogActionClassName}
              onClick={() => {
                setDialogDismissed(true)
                setReconnecting(true)
              }}
            >
              Reconnect GitHub App
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={forgetDialogOpen}
        onOpenChange={(open) => {
          if (!forgetLocalApp.isPending) setForgetDialogOpen(open)
        }}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset local GitHub configuration?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the unreadable GitHub App configuration from Ploydok
              only. It does not uninstall or delete the App on GitHub, and it
              does not modify any GitHub installation. You must manage the
              existing App and its installations manually on GitHub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {forgetLocalApp.error && (
            <p className="text-sm text-destructive" role="alert">
              {forgetLocalApp.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              className={responsiveDialogActionClassName}
              disabled={forgetLocalApp.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              className={responsiveDialogActionClassName}
              variant="destructive"
              loading={forgetLocalApp.isPending}
              onClick={() => void handleForgetLocalApp()}
            >
              {forgetLocalApp.isPending
                ? "Resetting local configuration..."
                : "Reset local configuration"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

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
  const credentialsStatus = useGitHubAppCredentialsStatus({
    enabled: isAdmin && appConfig?.configured === true,
  })
  const createApp = useCreateGitHubAppFlow("/settings/git-providers/github")
  const resetApp = useResetGitHubApp()
  const [resetError, setResetError] = React.useState<string | null>(null)
  const [appSuccess, setAppSuccess] = React.useState<boolean>(
    appParam === "created"
  )
  const credentialsUnreadable = credentialsStatus.data?.status === "unreadable"

  if (meLoading || providerStatus.isLoading) {
    return <GitHubStatusSkeleton />
  }

  if (!isAdmin) {
    const status = providerStatus.data?.github
    return (
      <div className="space-y-6">
        <GitHubUserConnection status={status} />
        {status?.configured && (
          <InstallationsCard
            role="member"
            installUrl={connectionHref(status.install_url)}
          />
        )}
      </div>
    )
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

      <GitHubCredentialsRecovery
        unreadable={credentialsUnreadable}
        onImported={() => setAppSuccess(true)}
      />

      {appConfig?.configured && credentialsStatus.isError && (
        <p className="text-sm text-destructive" role="alert">
          Failed to verify GitHub App credentials:{" "}
          {credentialsStatus.error.message}
        </p>
      )}

      {canLoadGitHubInstallations(
        appConfig?.configured === true,
        credentialsStatus.data?.status
      ) && (
        <InstallationsCard
          role="admin"
          installUrl={connectionHref(appConfig?.install_url)}
        />
      )}
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
                ? "An instance administrator must link a GitHub account or organization before you can import repositories."
                : "An instance administrator must configure the GitHub App before you can connect."}
          </p>
        </div>
      </div>
    </section>
  )
}

type InstallationRole = "admin" | "member"

export function InstallationsCard({
  role,
  installUrl: installUrlFallback,
}: {
  role: InstallationRole
  installUrl: string | null
}): React.JSX.Element {
  const { data, isLoading, isFetching, error, refetch } = useInstallations()
  const remove = useRemoveGitHubInstallation()
  const [pendingId, setPendingId] = React.useState<number | null>(null)
  const [revokeError, setRevokeError] = React.useState<string | null>(null)
  const [selectedInstallation, setSelectedInstallation] = React.useState<
    AppInstallation | undefined
  >(undefined)
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
        admin_required:
          "An instance administrator must add GitHub accounts or organizations.",
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

  const handleRemove = async (installation: AppInstallation): Promise<void> => {
    setRevokeError(null)
    setPendingId(installation.id)
    try {
      await remove.mutateAsync(installation.id)
      setSelectedInstallation(undefined)
    } catch (err) {
      setRevokeError(
        err instanceof Error
          ? err.message
          : role === "admin"
            ? "Failed to revoke installation"
            : "Failed to disconnect installation"
      )
    } finally {
      setPendingId(null)
    }
  }

  const installUrl = data?.installUrl ?? installUrlFallback ?? ""
  const hasInstallation =
    Boolean(justInstalled) || Boolean(data && data.installations.length > 0)

  return (
    <>
      <div
        className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
        data-testid="github-installations-header"
      >
        <div>
          <h2 className="text-base font-semibold">Active installations</h2>
          <p className="text-sm text-muted-foreground">
            Accounts and organizations where the Ploydok GitHub App is
            installed.
            {role === "admin"
              ? " Revoking removes the App from that GitHub account or organization."
              : " Disconnecting removes only your local Ploydok link. An instance administrator must add new accounts or organizations."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:flex-wrap sm:justify-end">
          {role === "admin" && installUrl && (
            <Button
              className="w-full sm:w-auto"
              size="sm"
              onClick={() => handleStartInstall(installUrl)}
            >
              Add account or organization
            </Button>
          )}
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            loading={isFetching}
          >
            {isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
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
          <InstallationsEmptyState />
        ) : (
          <ul className="divide-y divide-border">
            {data.installations.map((inst) => (
              <InstallationRow
                key={inst.id}
                installation={inst}
                isPending={pendingId === inst.id}
                role={role}
                onRemove={() => {
                  setRevokeError(null)
                  setSelectedInstallation(inst)
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {role === "admin" && hasInstallation && (
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

      <AlertDialog
        open={selectedInstallation !== undefined}
        onOpenChange={(open) => {
          if (!open && pendingId === null) {
            setSelectedInstallation(undefined)
            setRevokeError(null)
          }
        }}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {role === "admin"
                ? "Revoke GitHub installation?"
                : "Disconnect GitHub installation?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {role === "admin" ? (
                <>
                  This uninstalls the Ploydok GitHub App from{" "}
                  <strong>@{selectedInstallation?.accountLogin}</strong> on
                  GitHub and removes its repository access.
                </>
              ) : (
                <>
                  This removes your local Ploydok link to{" "}
                  <strong>@{selectedInstallation?.accountLogin}</strong>. It
                  does not uninstall the App or change any installation on
                  GitHub.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && (
            <p className="text-sm text-destructive" role="alert">
              {revokeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              className={responsiveDialogActionClassName}
              disabled={pendingId !== null}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              className={responsiveDialogActionClassName}
              variant="destructive"
              loading={pendingId !== null}
              onClick={() => {
                if (selectedInstallation) {
                  void handleRemove(selectedInstallation)
                }
              }}
            >
              {pendingId !== null
                ? role === "admin"
                  ? "Revoking..."
                  : "Disconnecting..."
                : role === "admin"
                  ? "Revoke"
                  : "Disconnect"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  role,
  onRemove,
}: {
  installation: AppInstallation
  isPending: boolean
  role: InstallationRole
  onRemove: () => void
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
        onClick={onRemove}
        loading={isPending}
      >
        {isPending
          ? role === "admin"
            ? "Revoking..."
            : "Disconnecting..."
          : role === "admin"
            ? "Revoke"
            : "Disconnect"}
      </Button>
    </li>
  )
}

function InstallationsEmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        The GitHub App is configured but has no repository access yet. Install
        it on a GitHub account or organization to enable repository import.
      </p>
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
      <div className="size-10 skeleton-surface rounded-full" />
      <div className="space-y-2">
        <div className="h-4 w-32 skeleton-surface rounded" />
        <div className="h-3 w-48 skeleton-surface rounded" />
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
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false)

  const handleResetConfirm = (): void => {
    setResetDialogOpen(false)
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
          onClick={() => setResetDialogOpen(true)}
          loading={isPending}
        >
          {isPending ? "Uninstalling..." : "Reset App"}
        </Button>
      </div>

      <AlertDialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          if (!isPending) setResetDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this GitHub App?</AlertDialogTitle>
            <AlertDialogDescription>
              This will uninstall <strong>{name}</strong> from every connected
              GitHub account or organization and delete its local Ploydok
              configuration. You will need to create and install the App again.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={isPending}
              onClick={handleResetConfirm}
            >
              {isPending ? "Uninstalling..." : "Reset App"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
