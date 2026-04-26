// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { AppStatusBadge } from "../apps/AppStatusBadge"
import {
  resolveAppHealth,
  resolveRuntimeAppStatus,
  selectAppSnapshot,
  type AppHealth,
} from "../../lib/app-runtime"
import { useMonitoring } from "../../lib/monitoring"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../lib/organizations"
import type { AppListItem } from "../../lib/apps"

// ---------------------------------------------------------------------------
// AppsGrid
// ---------------------------------------------------------------------------

interface AppsGridProps {
  apps: Array<AppListItem>
  isLoading: boolean
  onCreateApp: () => void
}

export function AppsGrid({
  apps,
  isLoading,
  onCreateApp,
}: AppsGridProps): React.JSX.Element {
  const { data: monitoring } = useMonitoring()
  const containers = monitoring?.containers ?? []

  if (isLoading) {
    return <AppsGridSkeleton />
  }

  if (apps.length === 0) {
    return <AppsEmptyState onCreateApp={onCreateApp} />
  }

  // Sort by updatedAt desc, take 6
  const recent = [...apps]
    .map((app) => {
      const snapshot = selectAppSnapshot(containers, app.id)
      return {
        ...app,
        runtimeStatus: resolveRuntimeAppStatus(app.status, snapshot),
        runtimeHealth: resolveAppHealth(snapshot),
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Recent apps
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {recent.map((app) => (
          <AppMiniCard key={app.id} app={app} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AppMiniCard
// ---------------------------------------------------------------------------

function AppMiniCard({
  app,
}: {
  app: AppListItem & {
    runtimeStatus: AppListItem["status"]
    runtimeHealth: AppHealth | null
  }
}): React.JSX.Element {
  const orgSlug = useCurrentOrganizationSlug()
  return (
    <Link
      to={
        (orgSlug
          ? organizationPath(orgSlug, `apps/${app.id}/settings`)
          : `/apps/${app.id}/settings`) as never
      }
      className="block space-y-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-muted-foreground/30 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{app.name}</p>
          {app.repoFullName && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {app.repoFullName}
            </p>
          )}
        </div>
        <AppStatusBadge status={app.runtimeStatus} health={app.runtimeHealth} />
      </div>
      {app.branch && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <BranchIcon className="size-3 shrink-0" />
          <span className="truncate">{app.branch}</span>
        </div>
      )}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function AppsEmptyState({
  onCreateApp,
}: {
  onCreateApp: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-10 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">
        <GridIcon className="size-5 text-muted-foreground" />
      </div>
      <p className="mb-1 text-sm font-medium">No apps yet</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Create your first app to start deploying.
      </p>
      <button
        type="button"
        onClick={onCreateApp}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        New app
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function AppsGridSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
      <div className="grid animate-pulse gap-3 sm:grid-cols-2">
        {[...Array<null>(4)].map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
              </div>
              <div className="h-5 w-16 rounded-full bg-muted" />
            </div>
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function BranchIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function GridIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  )
}
