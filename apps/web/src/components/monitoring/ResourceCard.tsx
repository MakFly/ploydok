// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

import { memRatio } from "@ploydok/shared"
import {
  RiCpuLine,
  RiDatabase2Line,
  RiRestartLine,
  RiWifiLine,
} from "@remixicon/react"

import { ContainerChart } from "./ContainerChart"
import { StatusDot } from "./StatusDot"
import type { ContainerSnapshot } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h < 24) return rem > 0 ? `${h}h ${rem}m` : `${h}h`
  const d = Math.floor(h / 24)
  const remH = h % 24
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// ---------------------------------------------------------------------------
// Kind icon
// ---------------------------------------------------------------------------

function KindIcon({ kind }: { kind: ContainerSnapshot["kind"] }) {
  if (kind === "app") return <RiDatabase2Line className="size-4 opacity-60" />
  if (kind === "infra") return <RiDatabase2Line className="size-4 opacity-60" />
  // agent or unknown
  return <RiCpuLine className="size-4 opacity-60" />
}

// ---------------------------------------------------------------------------
// ResourceCard
// ---------------------------------------------------------------------------

interface ResourceCardProps {
  snapshot: ContainerSnapshot
  cpuHistory: Array<number>
  memHistory: Array<number>
  onPing?: () => void
}

export function ResourceCard({
  snapshot,
  cpuHistory,
  memHistory,
  onPing,
}: ResourceCardProps) {
  const ratio = memRatio(snapshot)
  const ratioPercent = Math.round(ratio * 100)

  // Mem bar colour
  const barColor =
    ratio > 0.85
      ? "bg-red-500"
      : ratio > 0.65
        ? "bg-amber-400"
        : "bg-emerald-500"

  return (
    <div className="flex flex-col gap-3 rounded-[1.4rem] border border-border/70 bg-white/90 p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KindIcon kind={snapshot.kind} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {snapshot.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {snapshot.image}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={snapshot.status} />
          <span className="text-[11px] font-medium capitalize text-slate-600">
            {snapshot.status}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <StatChip
          icon={<RiRestartLine className="size-3.5" />}
          label="Uptime"
          value={formatUptime(snapshot.uptime_s)}
        />
        <StatChip
          icon={<RiCpuLine className="size-3.5" />}
          label="CPU"
          value={`${snapshot.cpu_pct.toFixed(1)}%`}
        />
        <StatChip
          icon={<RiRestartLine className="size-3.5" />}
          label="Restarts"
          value={String(snapshot.restart_count)}
        />
      </div>

      {/* Mem bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>Memory</span>
          <span>
            {formatBytes(snapshot.mem_bytes)} /{" "}
            {formatBytes(snapshot.mem_limit_bytes)} ({ratioPercent}%)
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={["h-full rounded-full transition-all", barColor].join(
              " ",
            )}
            style={{ width: `${ratioPercent}%` }}
          />
        </div>
      </div>

      {/* Sparklines Recharts — interactives avec tooltip au survol. */}
      <div className="grid grid-cols-2 gap-2">
        <ChartBlock label="CPU" color="text-blue-500">
          <ContainerChart
            points={cpuHistory}
            dataKey="cpu"
            label="CPU"
            color="#3b82f6"
            formatValue={(v) => `${v.toFixed(2)} %`}
            className="aspect-[3/1] h-10 w-full"
          />
        </ChartBlock>
        <ChartBlock label="Memory" color="text-violet-500">
          <ContainerChart
            points={memHistory.map((v) => v / 1_048_576)}
            dataKey="mem"
            label="Mem"
            color="#8b5cf6"
            formatValue={(v) => `${v.toFixed(1)} MB`}
            className="aspect-[3/1] h-10 w-full"
          />
        </ChartBlock>
      </div>

      {/* Ping button + last ping result */}
      {onPing ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onPing}
            className="flex items-center gap-1.5 rounded-full border border-border/70 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white"
          >
            <RiWifiLine className="size-3.5" />
            Ping
          </button>
          {snapshot.last_ping_ms !== undefined ? (
            <span
              className={[
                "text-[11px] font-medium",
                snapshot.last_ping_ok ? "text-emerald-600" : "text-red-500",
              ].join(" ")}
            >
              {snapshot.last_ping_ok ? "OK" : "KO"} · {snapshot.last_ping_ms}{" "}
              ms
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function StatChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-[0.75rem] border border-border/60 bg-[#f3f5f8] px-2.5 py-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function ChartBlock({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[0.75rem] border border-border/60 bg-[#f3f5f8] px-2.5 py-2">
      <p className={["text-[10px] font-medium uppercase tracking-widest", color].join(" ")}>
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}
