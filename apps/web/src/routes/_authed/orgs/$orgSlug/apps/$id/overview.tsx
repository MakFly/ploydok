// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
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
  RiExternalLinkLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiGithubFill,
} from "@remixicon/react"
import { toast } from "sonner"
import { useApp } from "../../../../../../lib/apps"
import { useUpdateAppSettings } from "../../../../../../lib/apps-mutations"
import { AppMonitoringCard } from "../../../../../../components/apps/AppMonitoringCard"
import { LastDeploymentCard } from "../../../../../../components/apps/LastDeploymentCard"
import { ActivityFeed } from "../../../../../../components/apps/ActivityFeed"
import { RegistryUsageWidget } from "../../../../../../components/apps/RegistryUsageWidget"
import type { AppDetail } from "../../../../../../lib/apps"
import type { RestartPolicy } from "@ploydok/shared"

function AppOverviewTab(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
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

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/overview")({
  component: AppOverviewTab,
})
