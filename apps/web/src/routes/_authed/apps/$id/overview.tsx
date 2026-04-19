// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
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
  RiExternalLinkLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiGithubFill,
} from "@remixicon/react"
import { toast } from "sonner"
import { apiFetch } from "../../../../lib/api"
import { useApp } from "../../../../lib/apps"
import { useUpdateAppSettings } from "../../../../lib/apps-mutations"
import { AppMonitoringCard } from "../../../../components/apps/AppMonitoringCard"
import { LastDeploymentCard } from "../../../../components/apps/LastDeploymentCard"
import { ActivityFeed } from "../../../../components/apps/ActivityFeed"
import type { AppDetail } from "../../../../lib/apps"
import type { RestartPolicy } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/apps/$id/overview")({
  component: AppOverviewTab,
})

function AppOverviewTab(): React.JSX.Element {
  const { id } = Route.useParams()
  const { data: app, isLoading, error } = useApp(id)

  if (isLoading) return <OverviewSkeleton />
  if (error || !app) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load app: {error?.message ?? "Not found"}
      </p>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AppMonitoringCard appId={id} appStatus={app.status} />
        </div>
        <div className="lg:col-span-1">
          <LastDeploymentCard appId={id} />
        </div>
      </section>

      <ConfigurationCard app={app} />

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityFeed appId={id} />
        </div>
        <div className="lg:col-span-1">
          <RegistryUsageWidget appId={id} />
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfigurationCard — single card grouping source + build + runtime metadata.
// Avoids the previous layout's fragmented 4-info-card row + separate policy
// section. Responsive 1/2/3-col grid of key/value tiles.
// ---------------------------------------------------------------------------

function ConfigurationCard({ app }: { app: AppDetail }): React.JSX.Element {
  const commitSha =
    app.currentCommitSha ?? app.builds?.find((b) => b.commitSha)?.commitSha ?? null

  return (
    <section className="rounded-lg border border-border bg-card p-5 md:p-6">
      <header className="mb-5">
        <h2 className="text-sm font-semibold text-foreground">Configuration</h2>
        <p className="text-xs text-muted-foreground">
          Source, build and runtime for this application.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <InfoTile
          label="Repository"
          value={app.repoFullName ?? "—"}
          href={app.repoFullName ? `https://github.com/${app.repoFullName}` : undefined}
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
// InfoTile — single metadata cell inside ConfigurationCard
// ---------------------------------------------------------------------------

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
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <div className="mt-1.5 min-w-0">{content}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RestartPolicyTile — inline editable tile inside ConfigurationCard
// Replaces the previous full-width RuntimePolicyCard section.
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save restart policy")
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Restart policy
      </p>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={value} onValueChange={(next) => setValue(next as RestartPolicy)}>
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

function formatHealthcheck(
  path: string | undefined,
  port: number | null | undefined,
): string {
  const normalizedPath = path && path !== "/" ? path : ""
  if (!normalizedPath && !port) return "—"
  if (!port) return normalizedPath || "—"
  return `${normalizedPath}:${port}`
}

function OverviewSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4 md:space-y-6 animate-pulse">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-48 rounded-lg border border-border bg-card" />
        <div className="lg:col-span-1 h-48 rounded-lg border border-border bg-card" />
      </div>
      <div className="h-64 rounded-lg border border-border bg-card" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-48 rounded-lg border border-border bg-card" />
        <div className="lg:col-span-1 h-48 rounded-lg border border-border bg-card" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registry usage widget
// ---------------------------------------------------------------------------

interface RegistryUsage {
  tags: number
  bytes: number
  diskPct: number
}

interface GcResult {
  reposScanned: number
  tagsDeleted: number
  bytesFreed: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function useRegistryUsage(appId: string) {
  return useQuery<RegistryUsage, Error>({
    queryKey: ["apps", appId, "registry-usage"],
    queryFn: () => apiFetch<RegistryUsage>(`/apps/${appId}/registry-usage`),
    staleTime: 30_000,
    enabled: Boolean(appId),
  })
}

function useRegistryGc(appId: string) {
  const qc = useQueryClient()
  return useMutation<GcResult, Error, void>({
    mutationFn: () =>
      apiFetch<GcResult>(`/apps/${appId}/registry-gc`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId, "registry-usage"] })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

function RegistryUsageWidget({ appId }: { appId: string }): React.JSX.Element {
  const { data, isLoading, error } = useRegistryUsage(appId)
  const gc = useRegistryGc(appId)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const handlePrune = async (): Promise<void> => {
    setConfirmOpen(false)
    try {
      const result = await gc.mutateAsync()
      toast.success(
        `Pruned ${result.tagsDeleted} image(s) across ${result.reposScanned} repo(s).`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "GC failed")
    }
  }

  const barTone =
    data && data.diskPct >= 80
      ? "bg-destructive"
      : data && data.diskPct >= 60
        ? "bg-foreground"
        : "bg-primary"

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">Registry storage</h3>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-5 w-24 rounded bg-muted" />
          <div className="h-2 w-full rounded bg-muted" />
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
        </p>
      )}

      {data && (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {data.tags}
            </span>
            <span className="text-xs text-muted-foreground">
              image{data.tags !== 1 ? "s" : ""}
            </span>
            {data.bytes > 0 && (
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {formatBytes(data.bytes)}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Host disk</span>
              <span className="tabular-nums">{data.diskPct}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={data.diskPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full transition-all ${barTone}`}
                style={{ width: `${Math.min(data.diskPct, 100)}%` }}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-auto pt-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={gc.isPending || isLoading}
          onClick={() => setConfirmOpen(true)}
        >
          {gc.isPending ? "Pruning…" : "Prune now"}
        </Button>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) setConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prune registry images?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all but the 3 most recent images for this app.
              Running containers are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handlePrune()}>
              Prune
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
