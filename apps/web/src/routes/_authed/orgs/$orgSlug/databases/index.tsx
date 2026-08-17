// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  RiAddLine,
  RiAlarmWarningLine,
  RiDatabase2Line,
  RiGlobalLine,
  RiRefreshLine,
  RiSearchLine,
  RiShieldCheckLine,
} from "@remixicon/react"
import {
  ShellPage,
  ShellPanel,
} from "../../../../../components/layout/AppShell"
import { CreateDatabaseDialog } from "../../../../../components/databases/CreateDatabaseDialog"
import { DatabaseCard } from "../../../../../components/databases/DatabaseCard"
import {
  filterDatabases,
  summarizeDatabases,
} from "../../../../../lib/database-list"
import { useDatabases } from "../../../../../lib/databases"
import { useCurrentOrganization } from "../../../../../lib/organizations"
import type {
  DatabaseKindFilter,
  DatabaseProtectionFilter,
  DatabaseStatusFilter,
} from "../../../../../lib/database-list"
import type { Database } from "../../../../../lib/databases"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/databases/")({
  component: DatabasesPage,
})

const DEFAULT_FILTERS = {
  query: "",
  kind: "all" as DatabaseKindFilter,
  status: "all" as DatabaseStatusFilter,
  protection: "all" as DatabaseProtectionFilter,
}

function DatabasesPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = React.useState(false)
  const [query, setQuery] = React.useState(DEFAULT_FILTERS.query)
  const [kind, setKind] = React.useState<DatabaseKindFilter>(
    DEFAULT_FILTERS.kind
  )
  const [status, setStatus] = React.useState<DatabaseStatusFilter>(
    DEFAULT_FILTERS.status
  )
  const [protection, setProtection] = React.useState<DatabaseProtectionFilter>(
    DEFAULT_FILTERS.protection
  )
  const organization = useCurrentOrganization()
  const organizationId = organization?.id ?? ""

  const {
    data: databases = [],
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useDatabases(organization?.id)

  const summary = React.useMemo(
    () => summarizeDatabases(databases),
    [databases]
  )
  const visibleDatabases = React.useMemo(
    () => filterDatabases(databases, { query, kind, status, protection }),
    [databases, kind, protection, query, status]
  )
  const unscheduledCount = summary.managed - summary.scheduled
  function clearFilters(): void {
    setQuery(DEFAULT_FILTERS.query)
    setKind(DEFAULT_FILTERS.kind)
    setStatus(DEFAULT_FILTERS.status)
    setProtection(DEFAULT_FILTERS.protection)
  }

  return (
    <ShellPage
      title="Databases"
      description="Provision, protect, and operate every database in this workspace."
      eyebrow={organization?.name ?? "Workspace"}
      actions={
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={!organizationId}
        >
          <RiAddLine className="size-4" />
          New database
        </Button>
      }
    >
      {!isLoading && !error && databases.length > 0 ? (
        <OperationalRail
          total={summary.total}
          healthy={summary.healthy}
          attention={summary.attention}
          publicCount={summary.public}
          scheduledCount={summary.scheduled}
          managed={summary.managed}
        />
      ) : null}

      {!isLoading &&
      !error &&
      databases.length > 0 &&
      (summary.attention > 0 || summary.public > 0 || unscheduledCount > 0) ? (
        <div
          className="flex flex-col gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <div className="flex min-w-0 items-start gap-3">
            <RiAlarmWarningLine className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Operational review needed
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[
                  summary.runtimeAttention > 0
                    ? `${summary.runtimeAttention} runtime issue${summary.runtimeAttention > 1 ? "s" : ""}`
                    : null,
                  summary.backupFailed > 0
                    ? `${summary.backupFailed} failed backup${summary.backupFailed > 1 ? "s" : ""}`
                    : null,
                  summary.public > 0
                    ? `${summary.public} publicly exposed`
                    : null,
                  unscheduledCount > 0
                    ? `${unscheduledCount} without scheduled backups`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQuery("")
              setKind("all")
              setStatus("all")
              setProtection("review")
            }}
          >
            Review affected databases
          </Button>
        </div>
      ) : null}

      <ShellPanel
        title="Database fleet"
        description="Runtime health, exposure, application links, and backup protection."
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh databases"
          >
            <RiRefreshLine
              className={isFetching ? "size-4 animate-spin" : "size-4"}
            />
            Refresh
          </Button>
        }
      >
        {databases.length > 0 ? (
          <DatabaseFilters
            query={query}
            kind={kind}
            status={status}
            protection={protection}
            resultCount={visibleDatabases.length}
            totalCount={databases.length}
            updatedAt={dataUpdatedAt}
            onQueryChange={setQuery}
            onKindChange={setKind}
            onStatusChange={setStatus}
            onProtectionChange={setProtection}
          />
        ) : null}

        {isLoading ? (
          <DatabasesGridSkeleton />
        ) : error ? (
          <LoadError message={error.message} onRetry={() => void refetch()} />
        ) : databases.length === 0 ? (
          <EmptyState
            onCreate={() => setCreateOpen(true)}
            disabled={!organizationId}
          />
        ) : visibleDatabases.length === 0 ? (
          <FilteredEmptyState onClear={clearFilters} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleDatabases.map((database: Database) => (
              <DatabaseCard key={database.id} database={database} />
            ))}
          </div>
        )}
      </ShellPanel>

      {organizationId ? (
        <CreateDatabaseDialog
          open={createOpen}
          organizationId={organizationId}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
    </ShellPage>
  )
}

function OperationalRail({
  total,
  healthy,
  attention,
  publicCount,
  scheduledCount,
  managed,
}: {
  total: number
  healthy: number
  attention: number
  publicCount: number
  scheduledCount: number
  managed: number
}): React.JSX.Element {
  const cells = [
    {
      label: "Fleet",
      value: String(total),
      icon: RiDatabase2Line,
      tone: "text-foreground",
    },
    {
      label: "Healthy",
      value: String(healthy),
      icon: RiShieldCheckLine,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Needs attention",
      value: String(attention),
      icon: RiAlarmWarningLine,
      tone:
        attention > 0
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground",
    },
    {
      label: "Public",
      value: String(publicCount),
      icon: RiGlobalLine,
      tone: publicCount > 0 ? "text-destructive" : "text-muted-foreground",
    },
    {
      label: "Scheduled",
      value: managed > 0 ? `${scheduledCount}/${managed}` : "—",
      icon: RiShieldCheckLine,
      tone:
        scheduledCount === managed
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-amber-600 dark:text-amber-400",
    },
  ]

  return (
    <section
      aria-label="Database operational summary"
      className="grid overflow-hidden rounded-2xl border border-panel-border bg-panel sm:grid-cols-5"
    >
      {cells.map((cell, index) => {
        const Icon = cell.icon
        return (
          <div
            key={cell.label}
            className={[
              "flex items-center justify-between gap-3 px-4 py-3 sm:block",
              index > 0
                ? "border-t border-border sm:border-t-0 sm:border-l"
                : "",
            ].join(" ")}
          >
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              <Icon className={`size-3.5 ${cell.tone}`} />
              {cell.label}
            </div>
            <p
              className={`font-mono text-lg font-semibold tabular-nums sm:mt-2 ${cell.tone}`}
            >
              {cell.value}
            </p>
          </div>
        )
      })}
    </section>
  )
}

function DatabaseFilters({
  query,
  kind,
  status,
  protection,
  resultCount,
  totalCount,
  updatedAt,
  onQueryChange,
  onKindChange,
  onStatusChange,
  onProtectionChange,
}: {
  query: string
  kind: DatabaseKindFilter
  status: DatabaseStatusFilter
  protection: DatabaseProtectionFilter
  resultCount: number
  totalCount: number
  updatedAt: number
  onQueryChange: (value: string) => void
  onKindChange: (value: DatabaseKindFilter) => void
  onStatusChange: (value: DatabaseStatusFilter) => void
  onProtectionChange: (value: DatabaseProtectionFilter) => void
}): React.JSX.Element {
  return (
    <div className="mb-4 space-y-3 border-b border-border pb-4">
      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_180px_190px]">
        <label className="relative block">
          <span className="sr-only">Search databases</span>
          <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search name, engine, host, or app…"
            className="pl-8"
          />
        </label>
        <Select
          value={kind}
          onValueChange={(value) => onKindChange(value as DatabaseKindFilter)}
        >
          <SelectTrigger aria-label="Filter by database engine">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All engines</SelectItem>
            <SelectItem value="postgres">PostgreSQL</SelectItem>
            <SelectItem value="mysql">MySQL</SelectItem>
            <SelectItem value="mariadb">MariaDB</SelectItem>
            <SelectItem value="redis">Redis</SelectItem>
            <SelectItem value="mongo">MongoDB</SelectItem>
            <SelectItem value="libsql">SQLite / libSQL</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) =>
            onStatusChange(value as DatabaseStatusFilter)
          }
        >
          <SelectTrigger aria-label="Filter by database status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="creating">Creating</SelectItem>
            <SelectItem value="starting">Starting</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={protection}
          onValueChange={(value) =>
            onProtectionChange(value as DatabaseProtectionFilter)
          }
        >
          <SelectTrigger aria-label="Filter by database protection">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exposure & backups</SelectItem>
            <SelectItem value="review">Needs review</SelectItem>
            <SelectItem value="protected">Last backup succeeded</SelectItem>
            <SelectItem value="unprotected">No scheduled backup</SelectItem>
            <SelectItem value="public">Publicly exposed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {resultCount === totalCount
            ? `${totalCount} databases`
            : `${resultCount} of ${totalCount} databases`}
        </span>
        <span>
          {updatedAt > 0
            ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Waiting for first refresh"}
        </span>
      </div>
    </div>
  )
}

function LoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4"
      role="alert"
    >
      <div>
        <p className="text-sm font-medium text-destructive">
          Databases could not be loaded
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function EmptyState({
  onCreate,
  disabled,
}: {
  onCreate: () => void
  disabled: boolean
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-panel-border bg-panel-inset px-6 py-12 text-center">
      <RiDatabase2Line className="mx-auto size-6 text-muted-foreground" />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No databases yet
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Provision the first database for this workspace.
      </p>
      <Button className="mt-5" size="sm" onClick={onCreate} disabled={disabled}>
        Create database
      </Button>
    </div>
  )
}

function FilteredEmptyState({
  onClear,
}: {
  onClear: () => void
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-panel-border bg-panel-inset px-6 py-10 text-center">
      <RiSearchLine className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No database matches these filters
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Clear the filters to return to the full fleet.
      </p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}

function DatabasesGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-panel-border bg-panel p-4"
        >
          <div className="h-4 w-32 rounded skeleton-surface" />
          <div className="mt-2 h-3 w-44 rounded skeleton-surface" />
          <div className="mt-6 h-3 w-20 rounded skeleton-surface" />
          <div className="mt-2 h-3 w-28 rounded skeleton-surface" />
        </div>
      ))}
    </div>
  )
}
