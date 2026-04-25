// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useParams, createFileRoute } from "@tanstack/react-router"
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
  RiCheckLine,
  RiCloseCircleLine,
  RiExternalLinkLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiHistoryLine,
  RiLoader4Line,
  RiPlayCircleLine,
  RiRefreshLine,
  RiRocketLine,
  RiStopCircleLine,
  RiTimeLine,
} from "@remixicon/react"
import { useApp, useBuilds } from "../../../../../../lib/apps"
import {
  useDeployApp,
  useRestartApp,
  useRollbackApp,
  useStopApp,
  useUpdateAppSettings,
} from "../../../../../../lib/apps-mutations"
import { AppStatusBadge } from "../../../../../../components/apps/AppStatusBadge"
import { BuildLogDrawer } from "../../../../../../components/apps/BuildLogDrawer"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { RiArrowRightLine, RiGithubFill } from "@remixicon/react"
import type { AppDetail } from "../../../../../../lib/apps"
import type {
  AppStatus,
  Build,
  BuildStatus,
  RestartPolicy,
} from "@ploydok/shared"
import { cn } from "@workspace/ui/lib/utils"
import { Skeleton } from "@workspace/ui/components/skeleton"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBuildDuration(start?: number, end?: number): string {
  if (!start) return "—"
  const ms = (end ?? Date.now()) - start
  if (ms < 1000) return `${Math.max(0, ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function formatRelative(ms?: number): string {
  if (!ms) return "—"
  const diff = (Date.now() - ms) / 1000
  if (diff < 5) return "just now"
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const BUILD_STATUS_VISUAL: Record<
  BuildStatus,
  { label: string; cls: string; Icon: typeof RiCheckLine; spin?: boolean }
> = {
  pending: {
    label: "Pending",
    cls: "text-zinc-400 bg-zinc-500/10",
    Icon: RiTimeLine,
  },
  running: {
    label: "Running",
    cls: "text-blue-400 bg-blue-500/10",
    Icon: RiLoader4Line,
    spin: true,
  },
  succeeded: {
    label: "Succeeded",
    cls: "text-emerald-500 bg-emerald-500/10",
    Icon: RiCheckLine,
  },
  succeeded_with_warning: {
    label: "Warning",
    cls: "text-amber-500 bg-amber-500/10",
    Icon: RiCheckLine,
  },
  failed: {
    label: "Failed",
    cls: "text-destructive bg-destructive/10",
    Icon: RiCloseCircleLine,
  },
  cancelled: {
    label: "Cancelled",
    cls: "text-muted-foreground bg-muted",
    Icon: RiCloseCircleLine,
  },
}

function isBuildInFlight(status: AppStatus): boolean {
  return (
    status === "building" || status === "pending" || status === "restarting"
  )
}

function isStopped(status: AppStatus): boolean {
  return status === "stopped" || status === "failed" || status === "created"
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function AppOverviewTab(): React.JSX.Element {
  const { id, orgSlug } = useParams({ strict: false }) as {
    id: string
    orgSlug: string
  }
  const { data: app, isLoading, error } = useApp(id)
  const { data: builds } = useBuilds(id)
  const [selectedBuildId, setSelectedBuildId] = React.useState<
    string | undefined
  >(undefined)

  const selectedBuild = React.useMemo(
    () => builds?.find((b) => b.id === selectedBuildId),
    [builds, selectedBuildId]
  )

  const handleViewLogs = React.useCallback((buildId: string) => {
    setSelectedBuildId(buildId)
  }, [])

  const handleCloseDrawer = React.useCallback(() => {
    setSelectedBuildId(undefined)
  }, [])

  if (isLoading)
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <OverviewSkeleton />
      </div>
    )
  if (error || !app) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <p className="text-sm text-destructive" role="alert">
          Failed to load app: {error?.message ?? "Not found"}
        </p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-5 px-4 py-6 md:space-y-6 md:px-8 md:py-8">
      <HeroCard app={app} onViewLogs={handleViewLogs} />
      <DeploySettingsCard app={app} orgSlug={orgSlug} />
      <SourceSummaryCard app={app} orgSlug={orgSlug} />
      <RecentDeploymentsCard
        appId={app.id}
        orgSlug={orgSlug}
        onViewLogs={handleViewLogs}
      />
      <BuildLogDrawer
        appId={app.id}
        buildId={selectedBuildId}
        build={selectedBuild}
        appName={app.name}
        onClose={handleCloseDrawer}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// HeroCard — compact identity + last deployment summary
// ---------------------------------------------------------------------------

function HeroCard({
  app,
  onViewLogs,
}: {
  app: AppDetail
  onViewLogs: (buildId: string) => void
}): React.JSX.Element {
  const { data: builds } = useBuilds(app.id)
  const lastBuild = builds?.[0]

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border",
        "bg-gradient-to-br from-card to-card/60 p-5 md:p-6"
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/5 blur-3xl"
      />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-3">
            <AppStatusBadge status={app.status} />
            {app.branch && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <RiGitBranchLine className="size-3" aria-hidden="true" />
                <span className="font-mono">{app.branch}</span>
              </span>
            )}
            {app.buildMethod && (
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                {app.buildMethod}
              </span>
            )}
          </div>

          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground md:text-2xl">
              {app.name}
            </h1>
            {app.publicUrl ? (
              <a
                href={app.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate text-sm text-primary hover:underline"
              >
                <span className="truncate">{app.publicUrl}</span>
                <RiExternalLinkLine
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
              </a>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No public domain configured
              </p>
            )}
          </div>
        </div>

        {app.publicUrl && (
          <div className="shrink-0">
            <Button size="sm" variant="outline" asChild className="gap-1.5">
              <a href={app.publicUrl} target="_blank" rel="noopener noreferrer">
                <RiExternalLinkLine className="size-4" aria-hidden="true" />
                Open app
              </a>
            </Button>
          </div>
        )}
      </div>

      {lastBuild && (
        <div className="relative mt-5 border-t border-border/60 pt-4">
          <LastDeploymentRow build={lastBuild} onViewLogs={onViewLogs} />
        </div>
      )}
    </section>
  )
}

function LastDeploymentRow({
  build,
  onViewLogs,
}: {
  build: Build
  onViewLogs: (buildId: string) => void
}): React.JSX.Element {
  const visual = BUILD_STATUS_VISUAL[build.status]
  const Icon = visual.Icon
  const sha = build.commitSha ? build.commitSha.slice(0, 7) : null
  const isInProgress = build.status === "running" || build.status === "pending"

  const [, forceTick] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!isInProgress) return
    const id = setInterval(forceTick, 1000)
    return () => clearInterval(id)
  }, [isInProgress])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
            visual.cls
          )}
          title={`Last build: ${visual.label}`}
        >
          <Icon
            className={cn("size-3.5", visual.spin && "animate-spin")}
            aria-hidden="true"
          />
        </span>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-medium text-foreground">{visual.label}</span>
            {sha && (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <RiGitCommitLine className="size-3" aria-hidden="true" />
                {sha}
              </span>
            )}
            {build.commitMessage && (
              <span className="hidden truncate text-xs text-muted-foreground md:inline">
                · {build.commitMessage}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
            <span>
              {formatBuildDuration(build.startedAt, build.finishedAt)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {formatRelative(
                build.finishedAt ?? build.startedAt ?? build.createdAt
              )}
            </span>
          </div>
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onViewLogs(build.id)}
        className="gap-1.5 self-start"
      >
        View logs
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeploySettingsCard — main actions panel (Dokploy-style)
// ---------------------------------------------------------------------------

function DeploySettingsCard({
  app,
  orgSlug,
}: {
  app: AppDetail
  orgSlug: string
}): React.JSX.Element {
  const { data: builds } = useBuilds(app.id)

  const deploy = useDeployApp(app.id)
  const restart = useRestartApp(app.id)
  const rollback = useRollbackApp(app.id)
  const stop = useStopApp(app.id)

  const inFlight = isBuildInFlight(app.status)
  const stopped = isStopped(app.status)
  const succeededBuilds = (builds ?? []).filter((b) => b.status === "succeeded")
  const canRollback = succeededBuilds.length >= 2

  const handleDeploy = React.useCallback(() => {
    deploy.mutate()
  }, [deploy])

  const handleRestart = React.useCallback(() => {
    restart.mutate()
  }, [restart])

  const handleRollback = React.useCallback(() => {
    // Default rollback API picks the previous succeeded build
    rollback.mutate()
  }, [rollback])

  const handleStop = React.useCallback(() => {
    stop.mutate()
  }, [stop])

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border/60 px-5 py-4 md:px-6">
        <h2 className="text-base font-semibold text-foreground">
          Deploy settings
        </h2>
        <p className="text-xs text-muted-foreground">
          Trigger a deploy, restart the container, roll back, or stop the app.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-5 py-4 md:px-6">
        {/* Deploy — full pipeline */}
        <Button
          variant="default"
          onClick={handleDeploy}
          disabled={deploy.isPending || inFlight}
          title="Pull source from git, build, and deploy"
          className="gap-1.5"
        >
          {deploy.isPending ? (
            <RiLoader4Line className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RiRocketLine className="size-4" aria-hidden="true" />
          )}
          {stopped ? "Deploy" : "Redeploy"}
        </Button>

        {/* Restart — re-run last image */}
        <ConfirmButton
          variant="secondary"
          icon={<RiRefreshLine className="size-4" />}
          label="Restart"
          title="Restart the container without rebuilding (uses the last successful image)"
          disabled={restart.isPending || stopped || inFlight}
          loading={restart.isPending}
          confirmTitle="Restart application?"
          confirmDescription="The current container will be replaced by a fresh instance running the last successful image. The app will be briefly unavailable."
          confirmActionLabel="Restart"
          onConfirm={handleRestart}
        />

        {/* Rollback — to previous succeeded build */}
        <ConfirmButton
          variant="secondary"
          icon={<RiHistoryLine className="size-4" />}
          label="Rollback"
          title={
            canRollback
              ? "Roll back to the previous successful build"
              : "Need at least two successful builds to roll back"
          }
          disabled={rollback.isPending || !canRollback || inFlight}
          loading={rollback.isPending}
          confirmTitle="Roll back to previous build?"
          confirmDescription={
            <>
              The app will be redeployed using the build immediately before the
              current one. The previous build remains available — you can roll
              forward later from the deployments tab.
            </>
          }
          confirmActionLabel="Roll back"
          onConfirm={handleRollback}
        />

        {/* Stop — destructive */}
        {!stopped && (
          <ConfirmButton
            variant="destructive"
            icon={<RiStopCircleLine className="size-4" />}
            label="Stop"
            title="Stop the running container and remove its public route"
            disabled={stop.isPending || inFlight}
            loading={stop.isPending}
            confirmTitle="Stop this application?"
            confirmDescription={
              <>
                <span className="mb-2 block">
                  The running container will be stopped and the public route
                  removed from Caddy.
                </span>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>The app will become unreachable on its public domain.</li>
                  <li>Non-persistent in-memory data will be lost.</li>
                  <li>Volumes and registry images are preserved.</li>
                </ul>
              </>
            }
            confirmActionLabel="Stop application"
            onConfirm={handleStop}
          />
        )}

        {/* Quick links */}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" asChild className="gap-1.5">
            <Link
              to="/orgs/$orgSlug/apps/$id/logs"
              params={{ orgSlug, id: app.id }}
            >
              View logs
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild className="gap-1.5">
            <Link
              to="/orgs/$orgSlug/apps/$id/deployments"
              params={{ orgSlug, id: app.id }}
            >
              All deployments
            </Link>
          </Button>
        </div>
      </div>

      {/* Inline hint for first deploy */}
      {(!builds || builds.length === 0) && !inFlight && (
        <div className="border-t border-border/60 bg-muted/30 px-5 py-3 md:px-6">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <RiPlayCircleLine className="size-3.5" aria-hidden="true" />
            No deployment yet — click{" "}
            <strong className="text-foreground">Deploy</strong> to build and
            ship the first version.
          </p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ConfirmButton — Button + AlertDialog combo
// ---------------------------------------------------------------------------

interface ConfirmButtonProps {
  variant: "secondary" | "destructive" | "default"
  icon: React.ReactNode
  label: string
  title: string
  disabled?: boolean
  loading?: boolean
  confirmTitle: string
  confirmDescription: React.ReactNode
  confirmActionLabel: string
  onConfirm: () => void
}

function ConfirmButton({
  variant,
  icon,
  label,
  title,
  disabled,
  loading,
  confirmTitle,
  confirmDescription,
  confirmActionLabel,
  onConfirm,
}: ConfirmButtonProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        variant={variant}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        {loading ? (
          <RiLoader4Line className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          icon
        )}
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground">
                {confirmDescription}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
              className={cn(
                variant === "destructive" &&
                  "text-destructive-foreground bg-destructive hover:bg-destructive/90"
              )}
            >
              {confirmActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// SourceSummaryCard — read-only summary of source/build (Dokploy-style)
// ---------------------------------------------------------------------------

const RESTART_POLICY_OPTIONS: Array<RestartPolicy> = [
  "unless-stopped",
  "no",
  "always",
  "on-failure",
]

function formatRestartPolicy(policy: RestartPolicy | undefined): string {
  switch (policy ?? "unless-stopped") {
    case "no":
      return "No auto-restart"
    case "always":
      return "Always"
    case "on-failure":
      return "On failure"
    case "unless-stopped":
    default:
      return "Unless stopped"
  }
}

function formatHealthcheck(
  path: string | undefined,
  port: number | null | undefined
): string {
  const normalizedPath = path && path !== "/" ? path : ""
  if (!normalizedPath && !port) return "—"
  if (!port) return normalizedPath || "—"
  return `${normalizedPath}:${port}`
}

interface InfoTileProps {
  label: string
  value: string
  mono?: boolean
  muted?: boolean
  href?: string
  title?: string
  icon?: React.ReactNode
}

function InfoTile({
  label,
  value,
  mono,
  muted,
  href,
  title,
  icon,
}: InfoTileProps): React.JSX.Element {
  const valueClass = [
    "truncate text-sm",
    mono ? "font-mono" : "font-medium",
    muted ? "text-muted-foreground" : "text-foreground",
    href ? "hover:underline" : "",
  ]
    .filter(Boolean)
    .join(" ")

  const content = href ? (
    <a
      className={`${valueClass} inline-flex items-center gap-1.5`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? value}
    >
      <span className="truncate">{value}</span>
      <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground" />
    </a>
  ) : (
    <p className={valueClass} title={title ?? value}>
      {value}
    </p>
  )

  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </p>
      <div className="mt-1.5 min-w-0">{content}</div>
    </div>
  )
}

function RestartPolicyTile({
  appId,
  restartPolicy,
}: {
  appId: string
  restartPolicy: RestartPolicy | undefined
}): React.JSX.Element {
  const update = useUpdateAppSettings(appId)
  const initial = restartPolicy ?? "unless-stopped"
  const [value, setValue] = React.useState<RestartPolicy>(initial)
  const [savedValue, setSavedValue] = React.useState<RestartPolicy>(initial)

  React.useEffect(() => {
    const next = restartPolicy ?? "unless-stopped"
    setValue(next)
    setSavedValue(next)
  }, [restartPolicy])

  const dirty = value !== savedValue

  const handleSave = async (): Promise<void> => {
    try {
      await update.mutateAsync({ restartPolicy: value })
      setSavedValue(value)
    } catch {
      // Hook already reports the error via notifyMutationError.
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Restart policy
      </p>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={value}
          onValueChange={(next) => setValue(next as RestartPolicy)}
        >
          <SelectTrigger
            className="h-8 w-full sm:max-w-56"
            aria-label="Container restart policy"
          >
            <SelectValue placeholder="Select a restart policy" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {RESTART_POLICY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatRestartPolicy(option)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {dirty ? (
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function SourceSummaryCard({
  app,
  orgSlug,
}: {
  app: AppDetail
  orgSlug: string
}): React.JSX.Element {
  const commitSha =
    app.currentCommitSha ??
    app.builds?.find((b) => b.commitSha)?.commitSha ??
    null

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Source &amp; build
          </h2>
          <p className="text-xs text-muted-foreground">
            Read-only summary — edit in Settings.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="gap-1.5 self-start"
        >
          <Link
            to="/orgs/$orgSlug/apps/$id/settings"
            params={{ orgSlug, id: app.id }}
          >
            Edit settings
            <RiArrowRightLine className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2 md:px-6 md:py-6 lg:grid-cols-4">
        <InfoTile
          label="Repository"
          value={app.repoFullName ?? "—"}
          href={
            app.repoFullName
              ? `https://github.com/${app.repoFullName}`
              : undefined
          }
          icon={<RiGithubFill className="size-3.5" />}
        />
        <InfoTile
          label="Branch"
          value={app.branch ?? "main"}
          icon={<RiGitBranchLine className="size-3.5" />}
        />
        <InfoTile
          label="Current commit"
          value={commitSha ? commitSha.slice(0, 7) : "—"}
          title={commitSha ?? undefined}
          mono
          icon={<RiGitCommitLine className="size-3.5" />}
        />
        <InfoTile
          label="Domain"
          value={app.domain ?? "Not set"}
          href={app.publicUrl ?? undefined}
          muted={!app.domain}
        />
        <InfoTile label="Build method" value={app.buildMethod ?? "auto"} mono />
        <InfoTile label="Root directory" value={app.rootDir ?? "/"} mono />
        <InfoTile
          label="Healthcheck"
          value={formatHealthcheck(app.healthcheckPath, app.healthcheckPort)}
          mono
        />
        <RestartPolicyTile appId={app.id} restartPolicy={app.restartPolicy} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// RecentDeploymentsCard — 5 last builds with link to deployments tab
// ---------------------------------------------------------------------------

function RecentDeploymentsCard({
  appId,
  orgSlug,
  onViewLogs,
}: {
  appId: string
  orgSlug: string
  onViewLogs: (buildId: string) => void
}): React.JSX.Element {
  const { data: builds, isLoading } = useBuilds(appId)
  const recent = (builds ?? []).slice(0, 5)
  const deploy = useDeployApp(appId)

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Recent deployments
          </h2>
          <p className="text-xs text-muted-foreground">
            Last 5 builds — full history in Deployments.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="gap-1.5 self-start"
        >
          <Link
            to="/orgs/$orgSlug/apps/$id/deployments"
            params={{ orgSlug, id: appId }}
          >
            All deployments
            <RiArrowRightLine className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </header>

      {isLoading ? (
        <div className="space-y-2 px-5 py-4 md:px-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-6 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="text-sm text-muted-foreground">
            No deployment yet. Trigger a first build to bring this app online.
          </p>
          <Button
            size="sm"
            onClick={() => deploy.mutate()}
            disabled={deploy.isPending}
            className="gap-1.5"
          >
            <RiRocketLine className="size-4" aria-hidden="true" />
            {deploy.isPending ? "Queuing…" : "Deploy now"}
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {recent.map((build) => (
            <RecentDeploymentRow
              key={build.id}
              build={build}
              onViewLogs={onViewLogs}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function RecentDeploymentRow({
  build,
  onViewLogs,
}: {
  build: Build
  onViewLogs: (buildId: string) => void
}): React.JSX.Element {
  const visual = BUILD_STATUS_VISUAL[build.status]
  const Icon = visual.Icon
  const sha = build.commitSha ? build.commitSha.slice(0, 7) : null
  const isInProgress = build.status === "running" || build.status === "pending"

  const [, forceTick] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!isInProgress) return
    const id = setInterval(forceTick, 1000)
    return () => clearInterval(id)
  }, [isInProgress])

  return (
    <li className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40 md:px-6">
      <span
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
          visual.cls
        )}
        title={visual.label}
      >
        <Icon
          className={cn("size-3.5", visual.spin && "animate-spin")}
          aria-hidden="true"
        />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {sha ? (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground">
              <RiGitCommitLine className="size-3" aria-hidden="true" />
              {sha}
            </span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {build.id.slice(0, 7)}
            </span>
          )}
          {build.commitMessage ? (
            <span className="truncate text-sm text-foreground">
              {build.commitMessage}
            </span>
          ) : (
            <span className="truncate text-sm text-muted-foreground">
              {visual.label}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <span>{formatBuildDuration(build.startedAt, build.finishedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {formatRelative(
              build.finishedAt ?? build.startedAt ?? build.createdAt
            )}
          </span>
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onViewLogs(build.id)}
        className="shrink-0"
      >
        View logs
      </Button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function OverviewSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5 md:space-y-6">
      <HeroCardSkeleton />
      <DeploySettingsCardSkeleton />
      <SourceSummaryCardSkeleton />
      <RecentDeploymentsCardSkeleton />
    </div>
  )
}

function HeroCardSkeleton(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-card/60 p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-7 w-56 md:h-8 md:w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-9 w-28 shrink-0 rounded-md" />
      </div>
      <div className="mt-5 border-t border-border/60 pt-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      </div>
    </section>
  )
}

function DeploySettingsCardSkeleton(): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-4 md:px-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-72" />
      </header>
      <div className="flex flex-wrap gap-2 px-5 py-3 md:px-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-md" />
        ))}
      </div>
      <div className="grid gap-5 border-t border-border/60 px-5 py-4 md:grid-cols-2 md:px-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full max-w-56" />
          </div>
        ))}
      </div>
    </section>
  )
}

function SourceSummaryCardSkeleton(): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </header>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 md:px-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </section>
  )
}

function RecentDeploymentsCardSkeleton(): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-4 md:px-6">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-8 w-20 rounded-md" />
      </header>
      <ul className="divide-y divide-border/60">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-5 py-3 md:px-6">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-7 w-20 rounded-md" />
          </li>
        ))}
      </ul>
    </section>
  )
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/overview"
)({
  component: AppOverviewTab,
})
