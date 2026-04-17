// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { useBuilds } from "../../lib/apps"
import { useDeployApp } from "../../lib/apps-mutations"
import { AppStatusBadge } from "./AppStatusBadge"
import type { Build } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(startedAt: number | undefined, finishedAt: number | undefined): string {
  if (startedAt === undefined || finishedAt === undefined) return "—"
  const ms = finishedAt - startedAt
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function truncateSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "unknown"
}

// ---------------------------------------------------------------------------
// Build status → AppStatus mapping for AppStatusBadge
// Build uses BuildStatus (pending/running/succeeded/failed/cancelled)
// AppStatus uses different values — we map for visual consistency.
// ---------------------------------------------------------------------------

function buildStatusToAppStatus(
  status: Build["status"],
): "running" | "failed" | "stopped" | "building" | "created" | "pending" {
  switch (status) {
    case "running":
      return "building"
    case "succeeded":
      return "running"
    case "failed":
      return "failed"
    case "cancelled":
      return "stopped"
    case "pending":
    default:
      return "pending"
  }
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CardSkeleton(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 animate-pulse">
      <div className="h-3 w-28 rounded bg-muted" />
      <div className="h-5 w-40 rounded bg-muted" />
      <div className="h-3 w-24 rounded bg-muted" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// NoBuilds — CTA when no build exists yet
// ---------------------------------------------------------------------------

interface NoBuildsProps {
  appId: string
}

function NoBuilds({ appId }: NoBuildsProps): React.JSX.Element {
  const deploy = useDeployApp(appId)
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Last deployment
      </p>
      <p className="text-sm text-muted-foreground">No deployments yet.</p>
      <Button
        size="sm"
        onClick={() => deploy.mutate()}
        disabled={deploy.isPending}
      >
        {deploy.isPending ? "Deploying…" : "Deploy now"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LastDeploymentCard
// ---------------------------------------------------------------------------

interface LastDeploymentCardProps {
  appId: string
}

export function LastDeploymentCard({
  appId,
}: LastDeploymentCardProps): React.JSX.Element {
  const { data: builds, isLoading } = useBuilds(appId)

  if (isLoading) return <CardSkeleton />

  const build = builds?.[0]

  if (!build) return <NoBuilds appId={appId} />

  const sha = truncateSha(build.commitSha)
  const duration = formatDuration(build.startedAt, build.finishedAt)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Header */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Last deployment
      </p>

      {/* Commit info */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="font-mono text-sm font-semibold text-slate-900 truncate">
            {sha}
          </p>
          {build.commitSha && build.commitSha.length > 7 && (
            <p className="text-xs text-muted-foreground truncate" title={build.commitSha}>
              {build.commitSha}
            </p>
          )}
        </div>
        {/* AppStatusBadge expects AppStatus-compatible string */}
        <AppStatusBadge status={buildStatusToAppStatus(build.status)} />
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Duration: {duration}</span>
        <span>Method: {build.buildMethod}</span>
      </div>
    </div>
  )
}

// Export pure helpers for tests
export { formatDuration, truncateSha, buildStatusToAppStatus }
