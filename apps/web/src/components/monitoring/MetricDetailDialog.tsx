// SPDX-License-Identifier: AGPL-3.0-only
//
// MetricDetailDialog — panneau de télémétrie plein pour un container, avec
// chart Recharts plein largeur, stats hero et footer metadata.

import * as React from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { RiCpuLine, RiDatabase2Line, RiPulseLine } from "@remixicon/react"

import {
  
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@workspace/ui/components/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import type {ChartConfig} from "@workspace/ui/components/chart";

import type { ContainerSnapshot } from "@ploydok/shared"

interface MetricDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  metric: "cpu" | "mem"
  snapshot: ContainerSnapshot
  /** Points en unité native: % pour CPU, MB pour mem. */
  points: Array<number>
  stepSeconds?: number
}

const METRIC_STYLES = {
  cpu: {
    icon: RiCpuLine,
    title: "CPU usage",
    unit: " %",
    decimals: 2,
    color: "#3b82f6",
    accentText: "text-blue-700",
    accentRail: "bg-blue-500",
    gradientId: "fill-cpu-detail",
  },
  mem: {
    icon: RiDatabase2Line,
    title: "Memory usage",
    unit: " MB",
    decimals: 1,
    color: "#8b5cf6",
    accentText: "text-violet-700",
    accentRail: "bg-violet-500",
    gradientId: "fill-mem-detail",
  },
} as const

export function MetricDetailDialog({
  open,
  onOpenChange,
  metric,
  snapshot,
  points,
  stepSeconds = 5,
}: MetricDetailDialogProps): React.JSX.Element {
  const style = METRIC_STYLES[metric]
  const Icon = style.icon

  const { current, max, avg, trimmed, data } = React.useMemo(() => {
    const t = points.slice(-60)
    if (t.length === 0) {
      return { current: 0, max: 0, avg: 0, trimmed: t, data: [] }
    }
    const last = t[t.length - 1] ?? 0
    const m = Math.max(...t)
    const a = t.reduce((acc, v) => acc + v, 0) / t.length
    const n = t.length
    const d = t.map((v, i) => ({
      t: -(n - 1 - i) * stepSeconds,
      value: v,
    }))
    return { current: last, max: m, avg: a, trimmed: t, data: d }
  }, [points, stepSeconds])

  const formatValue = React.useCallback(
    (v: number): string => `${v.toFixed(style.decimals)}${style.unit}`,
    [style.decimals, style.unit],
  )

  const chartConfig: ChartConfig = {
    value: {
      label: style.title,
      color: style.color,
    },
  }

  const updatedAgoSec = snapshot.last_seen_ms
    ? Math.max(0, Math.floor((Date.now() - snapshot.last_seen_ms) / 1000))
    : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        {/* Rail vertical coloré gauche — anchor visuel du metric */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            style.accentRail,
          )}
        />

        <div className="px-6 pt-6 pb-5">
          {/* Header */}
          <DialogHeader className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Icon className={cn("size-3.5", style.accentText)} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
                {style.title}
              </span>
            </div>
            <DialogTitle className="font-heading text-xl leading-tight">
              {snapshot.name}
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px] tabular-nums">
              {snapshot.image}
              {snapshot.kind ? (
                <>
                  <span className="mx-1.5 text-muted-foreground/50">·</span>
                  <span className="uppercase tracking-wider">{snapshot.kind}</span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {/* Hero stats: Current (big), Max, Average */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <HeroStat
              label="Current"
              value={formatValue(current)}
              valueClass={cn(
                "font-mono text-[28px] font-semibold leading-none tabular-nums",
                style.accentText,
              )}
            />
            <HeroStat
              label="Max (5min)"
              value={formatValue(max)}
              valueClass="font-mono text-[18px] font-semibold leading-none tabular-nums text-slate-800"
            />
            <HeroStat
              label="Average"
              value={formatValue(avg)}
              valueClass="font-mono text-[18px] font-semibold leading-none tabular-nums text-slate-800"
            />
          </div>

          {/* Chart principal */}
          <div className="mt-6">
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[260px] w-full"
            >
              <AreaChart
                accessibilityLayer
                data={data}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id={style.gradientId}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={style.color} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={style.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  opacity={0.18}
                />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", 0]}
                  ticks={computeXTicks(trimmed.length, stepSeconds)}
                  tickFormatter={formatXTick}
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: 10,
                    fill: "rgba(100, 116, 139, 0.8)",
                  }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, "auto"]}
                  tickFormatter={(v: number) =>
                    v.toFixed(style.decimals === 1 ? 0 : 1)
                  }
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tick={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: 10,
                    fill: "rgba(100, 116, 139, 0.8)",
                  }}
                />
                <ReferenceLine
                  y={avg}
                  stroke={style.color}
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  label={{
                    value: "avg",
                    position: "insideRight",
                    fill: style.color,
                    fontSize: 9,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  }}
                />
                <ChartTooltip
                  cursor={{
                    stroke: style.color,
                    strokeWidth: 1,
                    strokeDasharray: "3 3",
                    strokeOpacity: 0.6,
                  }}
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(_l, items) => {
                        const t = items[0]?.payload?.t as number | undefined
                        if (typeof t !== "number") return ""
                        if (t === 0) return "maintenant"
                        const s = Math.abs(t)
                        if (s < 60) return `il y a ${s}s`
                        const m = Math.round(s / 60)
                        return `il y a ${m}min`
                      }}
                      formatter={(value) => {
                        const num =
                          typeof value === "number" ? value : Number(value)
                        return formatValue(num)
                      }}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={style.color}
                  strokeWidth={2}
                  fill={`url(#${style.gradientId})`}
                  isAnimationActive
                  animationDuration={700}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ChartContainer>
          </div>

          {/* Footer metadata style terminal */}
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-border/60 pt-3 font-mono text-[10px] tabular-nums uppercase tracking-wider text-muted-foreground/80">
            <FooterStat
              icon={<RiPulseLine className="size-3" />}
              label="Samples"
              value={`${trimmed.length}/60`}
            />
            <FooterStat label="Interval" value={`${stepSeconds}s`} />
            <FooterStat label="Updated" value={`${updatedAgoSec}s ago`} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Sous-composants locaux
// ---------------------------------------------------------------------------

function HeroStat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-[0.85rem] border border-border/60 bg-slate-50/60 px-3.5 py-3">
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}

function FooterStat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-muted-foreground/60">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers ticks X-axis — on montre 4 ticks répartis : début, 1/3, 2/3, now.
// ---------------------------------------------------------------------------

function computeXTicks(n: number, step: number): Array<number> {
  if (n < 2) return [0]
  const maxT = 0
  const minT = -(n - 1) * step
  const third = minT / 3
  return [minT, Math.round(third * 2), Math.round(third), maxT]
}

function formatXTick(v: number): string {
  if (v === 0) return "now"
  const s = Math.abs(v)
  if (s < 60) return `-${s}s`
  const m = Math.round(s / 60)
  return `-${m}m`
}
