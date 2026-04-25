// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiLoader4Line, RiMoreLine } from "@remixicon/react"
import { DataTable } from "@workspace/ui/components/data-table"
import type { ColumnDef } from "@workspace/ui/components/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import type { Build, BuildStatus } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILD_STATUS_CLASS: Record<BuildStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  succeeded: "bg-green-500/10 text-green-600 dark:text-green-400",
  succeeded_with_warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
}

const BUILD_STATUS_LABEL: Record<BuildStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  succeeded_with_warning: "Succeeded (warning)",
  failed: "Failed",
  cancelled: "Cancelled",
}

const IN_PROGRESS_STATUSES: ReadonlySet<BuildStatus> = new Set([
  "pending",
  "running",
])

const BUILD_METHOD_LABEL: Record<string, string> = {
  docker: "Dockerfile",
  dockerfile: "Dockerfile",
  compose: "Compose",
  nixpacks: "Nixpacks",
  railpack: "Railpack",
}

const BUILD_METHOD_CLASS: Record<string, string> = {
  docker: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  dockerfile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  compose: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  nixpacks: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  railpack: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
}

export function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return "—"
  const diff = ((endMs ?? Date.now()) - startMs) / 1000
  if (diff < 60) return `${Math.round(diff)}s`
  const m = Math.floor(diff / 60)
  const s = Math.round(diff % 60)
  return `${m}m ${s}s`
}

/** Truncate text to `maxLen` chars, appending "…" if needed. */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + "…"
}

// Live-ticking duration cell. `formatDuration` reads `Date.now()` when the
// build has no `finishedAt`, but React only re-renders on state changes —
// so without a ticker the column was frozen until the next SSE-driven
// refetch. A per-row 1s interval (only enabled while the build is in
// progress) keeps the displayed value coherent with the wall clock.
function LiveDurationCell({
  startedAt,
  finishedAt,
  inProgress,
}: {
  startedAt?: number
  finishedAt?: number
  inProgress: boolean
}): React.JSX.Element {
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!inProgress) return
    const id = setInterval(forceTick, 1000)
    return () => clearInterval(id)
  }, [inProgress])

  return (
    <span className="text-xs text-muted-foreground">
      {formatDuration(startedAt, finishedAt)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DeploymentsTableProps {
  builds: Array<Build>
  /** Called when user clicks "View logs" on a build. */
  onSelectBuild: (buildId: string) => void
  /** Called when user confirms rollback on a build. */
  onRollback: (build: Build) => void
  /** Called when user confirms cancel on an in-progress build. */
  onCancel?: (build: Build) => void
  /** Loading state — shows skeleton rows when true. */
  isLoading?: boolean
}

// ---------------------------------------------------------------------------
// Row actions cell
// ---------------------------------------------------------------------------

interface RowActionsProps {
  build: Build
  onSelectBuild: (id: string) => void
  onRollback: (build: Build) => void
  onCancel?: (build: Build) => void
}

function RowActions({
  build,
  onSelectBuild,
  onRollback,
  onCancel,
}: RowActionsProps): React.JSX.Element {
  const canRollback =
    build.status === "succeeded" || build.status === "succeeded_with_warning"
  const canCancel = IN_PROGRESS_STATUSES.has(build.status)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none"
          aria-label="Row actions"
        >
          <RiMoreLine className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onSelectBuild(build.id)}>
          View logs
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canCancel && onCancel ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                Cancel deployment
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this deployment?</AlertDialogTitle>
                <AlertDialogDescription>
                  Mark build{" "}
                  <span className="font-mono">{build.id.slice(0, 8)}</span> as
                  cancelled and stop scheduling new work. A build already mid
                  push will finish its current phase, but no further steps will
                  run.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep running</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onCancel(build)}
                >
                  Cancel deployment
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {canRollback ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                Rollback to this build
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rollback to this build?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will roll the app back to build{" "}
                  <span className="font-mono">{build.id.slice(0, 8)}</span>
                  {build.commitSha ? ` (${build.commitSha.slice(0, 7)})` : ""}.
                  The current container will be replaced immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onRollback(build)}
                >
                  Rollback
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <DropdownMenuItem disabled>Rollback (unavailable)</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function makeColumns(
  onSelectBuild: (id: string) => void,
  onRollback: (build: Build) => void,
  onCancel?: (build: Build) => void
): Array<ColumnDef<Build>> {
  return [
    {
      id: "commit",
      header: "Commit",
      cell: ({ row }) => {
        const sha = row.original.commitSha
        const msg = row.original.commitMessage
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            {sha ? (
              <span className="font-mono text-xs">{sha.slice(0, 7)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
            {msg ? (
              <span
                className="max-w-[240px] truncate text-xs text-muted-foreground"
                title={msg}
              >
                {truncate(msg, 60)}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status
        const inProgress = IN_PROGRESS_STATUSES.has(status)
        const isWarning = status === "succeeded_with_warning"
        const postDeployError = row.original.postDeployError
        return (
          <span
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              BUILD_STATUS_CLASS[status],
            ].join(" ")}
            title={
              isWarning && postDeployError
                ? `Post-deploy hook failed: ${postDeployError}`
                : undefined
            }
          >
            {inProgress && (
              <RiLoader4Line
                className="size-3 animate-spin"
                aria-hidden="true"
              />
            )}
            {BUILD_STATUS_LABEL[status] ?? status}
          </span>
        )
      },
    },
    {
      id: "duration",
      header: "Duration",
      cell: ({ row }) => {
        const inProgress = IN_PROGRESS_STATUSES.has(row.original.status)
        return (
          <LiveDurationCell
            startedAt={row.original.startedAt}
            finishedAt={row.original.finishedAt}
            inProgress={inProgress}
          />
        )
      },
    },
    {
      id: "method",
      header: "Method",
      cell: ({ row }) => {
        const method = row.original.buildMethod
        if (!method) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        const label = BUILD_METHOD_LABEL[method] ?? method
        const cls =
          BUILD_METHOD_CLASS[method] ?? "bg-muted text-muted-foreground"
        return (
          <span
            className={[
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              cls,
            ].join(" ")}
          >
            {label}
          </span>
        )
      },
    },
    {
      id: "started",
      header: "Started",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.startedAt
            ? new Date(row.original.startedAt).toLocaleString()
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <RowActions
            build={row.original}
            onSelectBuild={onSelectBuild}
            onRollback={onRollback}
            onCancel={onCancel}
          />
        </div>
      ),
    },
  ]
}

// ---------------------------------------------------------------------------
// DeploymentsTable
// ---------------------------------------------------------------------------

export function DeploymentsTable({
  builds,
  onSelectBuild,
  onRollback,
  onCancel,
  isLoading,
}: DeploymentsTableProps): React.JSX.Element {
  const columns = React.useMemo(
    () => makeColumns(onSelectBuild, onRollback, onCancel),
    [onSelectBuild, onRollback, onCancel]
  )

  if (isLoading) {
    return <DeploymentsTableSkeleton />
  }

  if (!builds || builds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
        <p className="mb-1 text-sm font-medium">No deployments yet</p>
        <p className="text-sm text-muted-foreground">
          Trigger a deploy to start your first deployment.
        </p>
      </div>
    )
  }

  return (
    <DataTable<Build>
      columns={columns}
      rows={builds}
      pageSize={10}
      onRowClick={(build) => onSelectBuild(build.id)}
    />
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DeploymentsTableSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse overflow-hidden rounded-lg border border-border">
      <div className="h-10 bg-muted/40" />
      {[...Array<null>(4)].map((_, i) => (
        <div key={i} className="flex gap-4 border-t border-border/60 px-4 py-3">
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
          <div className="h-4 w-12 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
