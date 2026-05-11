// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  RiAlarmWarningLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiCpuLine,
  RiErrorWarningLine,
  RiFilter3Line,
  RiPulseLine,
  RiRadarLine,
  RiRefreshLine,
  RiSearchLine,
  RiServerLine,
} from "@remixicon/react"
import { healthClass } from "@ploydok/shared"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import {
  useOrgMonitoring,
  useOrgMonitoringEvents,
  usePingOrgContainer,
} from "../../../../lib/org-monitoring"
import { ResourceCard } from "../../../../components/monitoring/ResourceCard"
import { SystemHealthCard } from "../../../../components/monitoring/SystemHealthCard"
import { HostHealthCard } from "../../../../components/monitoring/HostHealthCard"
import { ShellPage } from "../../../../components/layout/AppShell"
import { useCurrentOrganizationSlug } from "../../../../lib/organizations"
import type {
  ContainerKind,
  ContainerSnapshot,
  HealthClass,
  MonitoringOverview,
} from "@ploydok/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/monitoring")({
  component: OrgMonitoringPage,
})

const RING_SIZE = 60

function appendRing(buf: Array<number>, value: number): Array<number> {
  const next = [...buf, value]
  return next.length > RING_SIZE ? next.slice(next.length - RING_SIZE) : next
}

type RingMap = Map<string, { cpu: Array<number>; mem: Array<number> }>

type KindFilter = "all" | ContainerKind | "unknown"
type HealthFilter = "all" | HealthClass

function OrgMonitoringPage(): React.JSX.Element {
  const orgSlug = useCurrentOrganizationSlug()
  const { data, isLoading, error, isFetching, refetch } = useOrgMonitoring(
    orgSlug ?? ""
  )
  const queryClient = useQueryClient()
  const ping = usePingOrgContainer(orgSlug ?? "")

  const ringsRef = React.useRef<RingMap>(new Map())
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0)

  const [query, setQuery] = React.useState("")
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all")
  const [healthFilter, setHealthFilter] = React.useState<HealthFilter>("all")

  React.useEffect(() => {
    if (!data) return
    for (const snap of data.containers) {
      const prev = ringsRef.current.get(snap.id) ?? { cpu: [], mem: [] }
      ringsRef.current.set(snap.id, {
        cpu: appendRing(prev.cpu, snap.cpu_pct),
        mem: appendRing(prev.mem, snap.mem_bytes),
      })
    }
  }, [data])

  const handleHealthEvent = React.useCallback(
    (snap: ContainerSnapshot) => {
      const prev = ringsRef.current.get(snap.id) ?? { cpu: [], mem: [] }
      ringsRef.current.set(snap.id, {
        cpu: appendRing(prev.cpu, snap.cpu_pct),
        mem: appendRing(prev.mem, snap.mem_bytes),
      })
      queryClient.setQueryData<MonitoringOverview>(
        ["org-monitoring", "overview", orgSlug],
        (old) => {
          if (!old) return old
          return {
            ...old,
            containers: old.containers.map((c) =>
              c.id === snap.id ? snap : c
            ),
          }
        }
      )
      forceRender()
    },
    [queryClient, orgSlug]
  )

  useOrgMonitoringEvents(handleHealthEvent)

  const containers = data?.containers ?? []

  const stats = React.useMemo(() => {
    let cpuSum = 0
    let memSum = 0
    let memLimitSum = 0
    let healthy = 0
    let warn = 0
    let down = 0
    for (const c of containers) {
      cpuSum += c.cpu_pct
      memSum += c.mem_bytes
      memLimitSum += c.mem_limit_bytes
      const cls = healthClass(c)
      if (cls === "healthy") healthy++
      else if (cls === "warn") warn++
      else down++
    }
    return {
      total: containers.length,
      healthy,
      warn,
      down,
      cpuSum,
      memSum,
      memLimitSum,
    }
  }, [containers])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return containers.filter((c) => {
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !c.image.toLowerCase().includes(q)
      ) {
        return false
      }
      if (kindFilter !== "all") {
        const kind = c.kind ?? "unknown"
        if (kind !== kindFilter) return false
      }
      if (healthFilter !== "all" && healthClass(c) !== healthFilter) {
        return false
      }
      return true
    })
  }, [containers, query, kindFilter, healthFilter])

  const now = Date.now()
  const generatedAt = data?.generated_at ?? 0
  const ageSec = generatedAt ? Math.floor((now - generatedAt) / 1000) : null
  const liveStatus: "live" | "stale" | "offline" =
    !generatedAt || ageSec === null
      ? "offline"
      : ageSec <= 10
        ? "live"
        : "stale"

  return (
    <ShellPage
      title="Monitoring"
      description="Real-time health of application and database runtimes in this workspace."
      eyebrow="Workspace"
      actions={
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors",
            "hover:bg-muted disabled:opacity-60"
          )}
        >
          <RiRefreshLine
            className={cn("size-3.5", isFetching && "animate-spin")}
          />
          Refresh
        </button>
      }
    >
      <div className="space-y-5">
        <SystemHealthCard />
        <HostHealthCard />

        <OpsStrip
          live={liveStatus}
          ageSec={ageSec}
          total={stats.total}
          healthy={stats.healthy}
          warn={stats.warn}
          down={stats.down}
          cpuSum={stats.cpuSum}
          memSum={stats.memSum}
          memLimitSum={stats.memLimitSum}
          isLoading={isLoading}
        />

        {data?.error ? (
          <InlineAlert
            tone="warning"
            icon={RiAlarmWarningLine}
            code={data.error.code}
            message={data.error.message}
          />
        ) : null}

        {error ? (
          <InlineAlert
            tone="destructive"
            icon={RiErrorWarningLine}
            code="fetch_failed"
            message={`Failed to load monitoring data: ${error.message}`}
          />
        ) : null}

        {containers.length > 0 ? (
          <FilterBar
            query={query}
            onQueryChange={setQuery}
            kind={kindFilter}
            onKindChange={setKindFilter}
            health={healthFilter}
            onHealthChange={setHealthFilter}
            stats={stats}
          />
        ) : null}

        {isLoading ? (
          <SkeletonGrid />
        ) : containers.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <NoResults
            onReset={() => {
              setQuery("")
              setKindFilter("all")
              setHealthFilter("all")
            }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((snap) => {
              const rings = ringsRef.current.get(snap.id) ?? {
                cpu: [],
                mem: [],
              }
              return (
                <ResourceCard
                  key={snap.id}
                  snapshot={snap}
                  cpuHistory={rings.cpu}
                  memHistory={rings.mem}
                  onPing={
                    snap.last_ping_ms !== undefined
                      ? () =>
                          ping.mutate({
                            id: snap.id,
                            path: "/",
                            port: 80,
                          })
                      : undefined
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </ShellPage>
  )
}

// ---------------------------------------------------------------------------
// Ops strip — dense horizontal metrics bar with live indicator.
// ---------------------------------------------------------------------------

interface OpsStripProps {
  live: "live" | "stale" | "offline"
  ageSec: number | null
  total: number
  healthy: number
  warn: number
  down: number
  cpuSum: number
  memSum: number
  memLimitSum: number
  isLoading: boolean
}

function OpsStrip({
  live,
  ageSec,
  total,
  healthy,
  warn,
  down,
  cpuSum,
  memSum,
  memLimitSum,
  isLoading,
}: OpsStripProps): React.JSX.Element {
  const liveStyles = {
    live: {
      dot: "bg-emerald-500",
      ring: "bg-emerald-500/60",
      label: "text-emerald-600 dark:text-emerald-400",
      text: "Live",
      animate: true,
    },
    stale: {
      dot: "bg-amber-500",
      ring: "bg-amber-500/60",
      label: "text-amber-600 dark:text-amber-400",
      text: "Stale",
      animate: false,
    },
    offline: {
      dot: "bg-destructive",
      ring: "bg-destructive/60",
      label: "text-destructive",
      text: "Offline",
      animate: false,
    },
  }[live]

  return (
    <section
      aria-label="Fleet overview"
      className="relative overflow-hidden rounded-xl border border-border bg-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--muted)_0%,transparent_55%)] opacity-60"
      />
      <div className="relative grid divide-y divide-border md:grid-cols-[auto_1fr] md:divide-x md:divide-y-0">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="relative flex size-2.5 shrink-0 items-center justify-center">
            {liveStyles.animate ? (
              <span
                className={cn(
                  "absolute inline-flex size-full animate-ping rounded-full",
                  liveStyles.ring
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full",
                liveStyles.dot
              )}
            />
          </span>
          <div className="space-y-0.5">
            <p
              className={cn(
                "font-mono text-[10px] tracking-wide uppercase",
                liveStyles.label
              )}
            >
              {liveStyles.text}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {ageSec === null
                ? "no signal"
                : ageSec < 2
                  ? "just now"
                  : `${ageSec}s ago`}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          <Metric
            label="Runtimes"
            value={isLoading ? "—" : String(total)}
            icon={RiServerLine}
          />
          <Metric
            label="Healthy"
            value={isLoading ? "—" : String(healthy)}
            icon={RiCheckboxCircleFill}
            accent={healthy > 0 ? "emerald" : "muted"}
          />
          <Metric
            label="Degraded"
            value={isLoading ? "—" : String(warn)}
            icon={RiAlarmWarningLine}
            accent={warn > 0 ? "amber" : "muted"}
          />
          <Metric
            label="Down"
            value={isLoading ? "—" : String(down)}
            icon={RiCloseCircleFill}
            accent={down > 0 ? "destructive" : "muted"}
          />
          <Metric
            label="Fleet CPU"
            value={isLoading ? "—" : `${cpuSum.toFixed(1)}%`}
            sub={
              isLoading
                ? undefined
                : `${formatBytes(memSum)} of ${formatBytes(memLimitSum)}`
            }
            icon={RiCpuLine}
          />
        </dl>
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  sub,
  icon: Icon,
  accent = "muted",
}: {
  label: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: "muted" | "emerald" | "amber" | "destructive"
}): React.JSX.Element {
  const accentText = {
    muted: "text-muted-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    destructive: "text-destructive",
  }[accent]
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <dt className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        <Icon className={cn("size-3", accentText)} />
        {label}
      </dt>
      <dd>
        <span
          className={cn(
            "font-heading text-xl font-medium tabular-nums",
            accentText === "text-muted-foreground"
              ? "text-foreground"
              : accentText
          )}
        >
          {value}
        </span>
        {sub ? (
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  query: string
  onQueryChange: (v: string) => void
  kind: KindFilter
  onKindChange: (v: KindFilter) => void
  health: HealthFilter
  onHealthChange: (v: HealthFilter) => void
  stats: {
    total: number
    healthy: number
    warn: number
    down: number
  }
}

function FilterBar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  health,
  onHealthChange,
  stats,
}: FilterBarProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup label="Kind" icon={RiFilter3Line}>
          <Chip
            active={kind === "all"}
            onClick={() => onKindChange("all")}
            count={stats.total}
          >
            All
          </Chip>
          <Chip active={kind === "app"} onClick={() => onKindChange("app")}>
            App
          </Chip>
          <Chip
            active={kind === "database"}
            onClick={() => onKindChange("database")}
          >
            Database
          </Chip>
          <Chip active={kind === "infra"} onClick={() => onKindChange("infra")}>
            Infra
          </Chip>
          <Chip active={kind === "agent"} onClick={() => onKindChange("agent")}>
            Agent
          </Chip>
        </ChipGroup>

        <ChipGroup label="Health" icon={RiPulseLine}>
          <Chip active={health === "all"} onClick={() => onHealthChange("all")}>
            All
          </Chip>
          <Chip
            active={health === "healthy"}
            onClick={() => onHealthChange("healthy")}
            count={stats.healthy}
            tone="emerald"
          >
            Healthy
          </Chip>
          <Chip
            active={health === "warn"}
            onClick={() => onHealthChange("warn")}
            count={stats.warn}
            tone="amber"
          >
            Degraded
          </Chip>
          <Chip
            active={health === "down"}
            onClick={() => onHealthChange("down")}
            count={stats.down}
            tone="destructive"
          >
            Down
          </Chip>
        </ChipGroup>
      </div>

      <div className="relative max-w-sm flex-1">
        <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by name or image…"
          className="h-8 pl-8 text-xs"
          aria-label="Filter runtimes"
        />
      </div>
    </div>
  )
}

function ChipGroup({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 p-0.5">
      <span className="flex items-center gap-1 pr-1 pl-2 font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  count,
  tone = "default",
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  tone?: "default" | "emerald" | "amber" | "destructive"
  children: React.ReactNode
}): React.JSX.Element {
  const toneCls =
    active && tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : active && tone === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : active && tone === "destructive"
          ? "text-destructive"
          : active
            ? "text-foreground"
            : "text-muted-foreground"
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[11px] font-medium transition-colors",
        active
          ? "bg-background shadow-[0_0_0_1px_var(--border)]"
          : "hover:text-foreground",
        toneCls
      )}
    >
      {children}
      {count !== undefined ? (
        <span className="font-mono text-[9px] opacity-60">{count}</span>
      ) : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Inline alert (replaces the old light-bg bordered div)
// ---------------------------------------------------------------------------

function InlineAlert({
  tone,
  icon: Icon,
  code,
  message,
}: {
  tone: "warning" | "destructive"
  icon: React.ComponentType<{ className?: string }>
  code: string
  message: string
}): React.JSX.Element {
  const cls =
    tone === "warning"
      ? "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300"
      : "border-destructive/30 bg-destructive/5 text-destructive"
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        cls
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-mono text-[10px] tracking-wide uppercase opacity-80">
          {code}
        </p>
        <p className="text-xs leading-5">{message}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton + Empty
// ---------------------------------------------------------------------------

function SkeletonGrid(): React.JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-border bg-card p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="size-8 rounded-md bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 rounded bg-muted" />
              <div className="h-2.5 w-24 rounded bg-muted/60" />
            </div>
            <div className="h-5 w-14 rounded-full bg-muted" />
          </div>
          <div className="mb-3 h-14 rounded-md bg-muted/60" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-14 rounded-md bg-muted/60" />
            <div className="h-14 rounded-md bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <RiRadarLine className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No runtime resources</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The agent will report application and database runtimes here as soon
          as services are deployed and running.
        </p>
      </div>
    </div>
  )
}

function NoResults({ onReset }: { onReset: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <RiSearchLine className="size-4 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No runtimes match</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Try relaxing the filters or clearing the search.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
      >
        Reset filters
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
