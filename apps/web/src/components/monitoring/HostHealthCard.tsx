// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCpuLine,
  RiHardDriveLine,
  RiPulseLine,
  RiServerLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import {  useHostStats } from "../../lib/host-stats"
import type {HostStats} from "../../lib/host-stats";

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(1)} GB`
  return `${(b / 1024 ** 4).toFixed(2)} TB`
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86_400)
  const h = Math.floor((secs % 86_400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function pctClass(pct: number, warnPct: number): string {
  if (pct >= warnPct) return "text-destructive"
  if (pct >= warnPct - 10) return "text-amber-600 dark:text-amber-400"
  return "text-emerald-600 dark:text-emerald-400"
}

export function HostHealthCard(): React.JSX.Element {
  const { data, isLoading, error } = useHostStats()

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded bg-muted/60" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400">
          host_stats_unavailable
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {error?.message ??
            "Agent injoignable — le monitoring host requiert l'agent Rust en marche."}
        </p>
      </div>
    )
  }

  return <HostHealthBody data={data} />
}

function HostHealthBody({ data }: { data: HostStats }): React.JSX.Element {
  const memPct =
    data.mem_total_bytes > 0
      ? (data.mem_used_bytes / data.mem_total_bytes) * 100
      : 0
  const diskPct =
    data.disk_total_bytes > 0
      ? (data.disk_used_bytes / data.disk_total_bytes) * 100
      : 0
  const loadPerCpu =
    data.cpu_count > 0 ? data.load_1 / data.cpu_count : data.load_1
  const inodesPct =
    data.inodes_total > 0 ? (data.inodes_used / data.inodes_total) * 100 : 0

  const t = data.thresholds
  const hasAlerts = data.alerts.length > 0

  return (
    <section
      aria-label="Host server health"
      className="rounded-xl border border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Host VPS
          </p>
          <p className="text-sm font-medium">
            Server health{" "}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              uptime {formatUptime(data.uptime_seconds)}
            </span>
          </p>
        </div>
        {hasAlerts ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-destructive/10 px-2 text-[11px] font-medium text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            {data.alerts.length} alert{data.alerts.length > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Healthy
          </span>
        )}
      </header>

      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        <Cell
          icon={RiCpuLine}
          label="CPU"
          value={`${data.cpu_percent.toFixed(1)}%`}
          sub={`${data.cpu_count} cores`}
        />
        <Cell
          icon={RiServerLine}
          label="Memory"
          value={`${memPct.toFixed(0)}%`}
          sub={`${formatBytes(data.mem_used_bytes)} / ${formatBytes(data.mem_total_bytes)}`}
          accent={pctClass(memPct, t.mem_warn_pct)}
        />
        <Cell
          icon={RiHardDriveLine}
          label="Disk /"
          value={`${diskPct.toFixed(0)}%`}
          sub={`${formatBytes(data.disk_used_bytes)} / ${formatBytes(data.disk_total_bytes)} · inodes ${inodesPct.toFixed(0)}%`}
          accent={pctClass(diskPct, t.disk_warn_pct)}
        />
        <Cell
          icon={RiPulseLine}
          label="Load avg"
          value={data.load_1.toFixed(2)}
          sub={`5m ${data.load_5.toFixed(2)} · 15m ${data.load_15.toFixed(2)} · ${loadPerCpu.toFixed(2)}/cpu`}
          accent={
            loadPerCpu > t.load_warn_per_cpu
              ? "text-destructive"
              : loadPerCpu > t.load_warn_per_cpu * 0.66
                ? "text-amber-600 dark:text-amber-400"
                : undefined
          }
        />
      </dl>

      {hasAlerts ? (
        <div className="border-t border-border bg-destructive/5 px-4 py-2 font-mono text-[11px] text-destructive">
          {data.alerts.join(" · ")}
        </div>
      ) : null}

      {data.error ? (
        <div className="border-t border-border bg-amber-500/5 px-4 py-2 font-mono text-[10px] text-amber-600 dark:text-amber-400">
          partial: {data.error}
        </div>
      ) : null}
    </section>
  )
}

function Cell({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  accent?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </dt>
      <dd className={cn("text-xl font-medium tabular-nums", accent)}>
        {value}
      </dd>
      {sub ? (
        <p className="font-mono text-[10px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  )
}
