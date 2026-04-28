// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  useCreateGitHubApp,
  useGitHubAppConfig,
  useGitHubCacheStatus,
  useImportGitHubApp,
  useInstallations,
  useResetGitHubApp,
  useRevokeInstallation,
  useSyncGitHubInstallations,
} from "../../../lib/github"
import { CachedReposPanel } from "./CachedReposPanel"
import { SyncProgressDialog } from "./SyncProgressDialog"
import { useSyncWithProgress } from "./useSyncWithProgress"
import type { AppInstallation, ImportGitHubAppPayload } from "../../../lib/github"

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
          <GitHubAppUnconfiguredState
            isPending={createApp.isPending}
            onCreate={() => void handleCreateApp()}
            onImported={() => setAppSuccess(true)}
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
  const [justInstalled, setJustInstalled] = React.useState<{
    id: string
    action: string
  } | null>(null)
  const [installError, setInstallError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const installationId = params.get("installation_id")
    const setupAction = params.get("setup_action")
    const installed = params.get("installed")
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
          "GitHub installation did not complete correctly. Please retry.",
      )
      setJustInstalled(null)
    } else if (installationId && setupAction && installed === "1") {
      setJustInstalled({ id: installationId, action: setupAction })
      setInstallError(null)
      void refetch()
    } else if (!installationId && !setupAction) {
      return
    }

    params.delete("installation_id")
    params.delete("setup_action")
    params.delete("installed")
    params.delete("install_error")
    params.delete("state")
    const next = params.toString()
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`)

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
  const hasInstallation =
    Boolean(justInstalled) || Boolean(data && data.installations.length > 0)

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
              Add another account →
            </button>
          </div>
        )}
      </div>

      {hasInstallation && <GitHubCacheSection />}
    </>
  )
}

function GitHubCacheSection(): React.JSX.Element {
  const sync = useSyncGitHubInstallations()
  const cache = useGitHubCacheStatus({})
  const progress = useSyncWithProgress()
  const [scope, setScope] = React.useState<"all" | string | undefined>(undefined)

  React.useEffect(() => {
    if (progress.status === "done") {
      void cache.refetch()
      setScope(undefined)
    }
    if (progress.status === "error" || progress.status === "idle") {
      setScope(undefined)
    }
  }, [progress.status, cache])

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
        The GitHub App is configured but has no repository access yet. Install it on a GitHub account or organization to enable repository import.
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
  onImported: () => void
  error: string | null
}

function GitHubAppUnconfiguredState({
  isPending,
  onCreate,
  onImported,
  error,
}: GitHubAppUnconfiguredStateProps): React.JSX.Element {
  const importApp = useImportGitHubApp()
  const [showImport, setShowImport] = React.useState(false)
  const [form, setForm] = React.useState<ImportGitHubAppPayload>({
    appId: "",
    clientId: "",
    clientSecret: "",
    privateKey: "",
    webhookSecret: "",
    slug: "",
    name: "",
  })
  const importError = importApp.error?.message ?? null
  const canImport = Boolean(
    form.appId.trim() &&
      form.clientId.trim() &&
      form.clientSecret.trim() &&
      form.privateKey.trim() &&
      form.slug.trim() &&
      form.name.trim(),
  )

  const updateField =
    (key: keyof ImportGitHubAppPayload) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.value }))
    }

  async function handleImport(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await importApp.mutateAsync({
      ...form,
      appId: form.appId.trim(),
      clientId: form.clientId.trim(),
      slug: form.slug.trim(),
      name: form.name.trim(),
      clientSecret: form.clientSecret.trim(),
      privateKey: form.privateKey.trim(),
      webhookSecret: form.webhookSecret?.trim() ?? "",
    })
    onImported()
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <GitHubIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">No GitHub App configured</p>
          <p className="text-xs text-muted-foreground">
            Create a new GitHub App, or reconnect the existing one after a local DB reset.
          </p>
        </div>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCreate} size="sm" disabled={isPending || importApp.isPending}>
          {isPending ? "Redirecting to GitHub..." : "Create GitHub App"}
        </Button>
        <Button
          type="button"
          onClick={() => setShowImport((value) => !value)}
          size="sm"
          variant="outline"
          disabled={isPending || importApp.isPending}
        >
          Reconnect existing App
        </Button>
      </div>
      {showImport && (
        <form
          className="grid w-full gap-3 border-t border-border pt-4 md:grid-cols-2"
          onSubmit={(event) => void handleImport(event)}
        >
          <label className="space-y-1 text-xs font-medium">
            App ID
            <Input value={form.appId} onChange={updateField("appId")} inputMode="numeric" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Client ID
            <Input value={form.clientId} onChange={updateField("clientId")} />
          </label>
          <label className="space-y-1 text-xs font-medium">
            App slug
            <Input value={form.slug} onChange={updateField("slug")} placeholder="ploydok-local" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            App name
            <Input value={form.name} onChange={updateField("name")} placeholder="Ploydok Local" />
          </label>
          <label className="space-y-1 text-xs font-medium md:col-span-2">
            Client secret
            <Input
              value={form.clientSecret}
              onChange={updateField("clientSecret")}
              type="password"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1 text-xs font-medium md:col-span-2">
            Private key
            <Textarea
              value={form.privateKey}
              onChange={updateField("privateKey")}
              rows={7}
              autoComplete="off"
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
            />
          </label>
          <label className="space-y-1 text-xs font-medium md:col-span-2">
            Webhook secret
            <Input
              value={form.webhookSecret}
              onChange={updateField("webhookSecret")}
              type="password"
              autoComplete="off"
              placeholder="Optional for local recovery"
            />
          </label>
          {importError && (
            <p className="text-sm text-destructive md:col-span-2" role="alert">
              {importError}
            </p>
          )}
          <div className="flex justify-end md:col-span-2">
            <Button size="sm" type="submit" disabled={!canImport || importApp.isPending}>
              {importApp.isPending ? "Reconnecting..." : "Save existing App"}
            </Button>
          </div>
        </form>
      )}
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
        `Uninstall ${name} from every GitHub account and remove the local Ploydok configuration? This cannot be undone from Ploydok.`,
      )
      if (!confirmed) return
    }
    onReset()
  }

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
            GitHub App registered. Repository access is managed from the active installations below.
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
        <Button
          variant="destructive"
          size="sm"
          onClick={handleResetClick}
          disabled={isPending}
        >
          {isPending ? "Uninstalling..." : "Reset App"}
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
