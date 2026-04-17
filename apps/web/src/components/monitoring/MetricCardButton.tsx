// SPDX-License-Identifier: AGPL-3.0-only
//
// MetricCardButton — instrument de mesure cliquable. Valeur courante en gros,
// delta discret, sparkline qui flotte en fond. Ouvre MetricDetailDialog au clic.

import * as React from "react"
import { RiCpuLine, RiDatabase2Line, RiExpandDiagonal2Line } from "@remixicon/react"

import { cn } from "@workspace/ui/lib/utils"

interface MetricCardButtonProps {
  metric: "cpu" | "mem"
  /** Valeur courante déjà formatée (ex. "0.42 %" ou "22.3 MB"). */
  value: string
  /** Ring buffer dans l'unité native (ex. % pour cpu, MB pour mem). */
  history: Array<number>
  /** Suffixe d'unité utilisé dans le label delta (ex. " %" ou " MB"). */
  unit: string
  onClick: () => void
}

const METRIC_STYLES = {
  cpu: {
    icon: RiCpuLine,
    label: "CPU",
    text: "text-blue-700",
    hoverBorder: "hover:border-blue-400/80",
    hoverBg: "hover:bg-blue-50/60",
    ring: "focus-visible:ring-blue-400",
    border: "border-blue-200/50",
    stroke: "#3b82f6",
    gradient: "from-blue-500/10",
  },
  mem: {
    icon: RiDatabase2Line,
    label: "Memory",
    text: "text-violet-700",
    hoverBorder: "hover:border-violet-400/80",
    hoverBg: "hover:bg-violet-50/60",
    ring: "focus-visible:ring-violet-400",
    border: "border-violet-200/50",
    stroke: "#8b5cf6",
    gradient: "from-violet-500/10",
  },
} as const

export function MetricCardButton({
  metric,
  value,
  history,
  unit,
  onClick,
}: MetricCardButtonProps): React.JSX.Element {
  const style = METRIC_STYLES[metric]
  const Icon = style.icon

  // Delta: dernier vs avant-dernier. `null` si <2 samples.
  const delta =
    history.length >= 2
      ? history[history.length - 1] - history[history.length - 2]
      : null

  const deltaLabel =
    delta === null
      ? null
      : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(unit === " %" ? 2 : 1)}${unit}`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Voir détail ${style.label}`}
      className={cn(
        "group/metric relative isolate flex w-full flex-col overflow-hidden",
        "rounded-[1rem] border bg-white/70 px-3 py-2.5 text-left",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        style.border,
        style.hoverBorder,
        style.hoverBg,
        style.ring,
      )}
    >
      {/* Gradient wash subtil dans la direction du metric */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-0 h-full bg-gradient-to-b to-transparent opacity-60",
          style.gradient,
        )}
      />

      {/* Sparkline flottante en fond — SVG inline léger */}
      <InlineSparkline
        points={history}
        stroke={style.stroke}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-11 w-full opacity-[0.22]"
      />

      {/* Header: icon + label + expand hint */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
            {style.label}
          </span>
        </div>
        <RiExpandDiagonal2Line
          className={cn(
            "size-3 shrink-0 text-muted-foreground/30 transition-all duration-200",
            "group-hover/metric:text-muted-foreground group-hover/metric:rotate-45",
          )}
        />
      </div>

      {/* Hero value + delta */}
      <div className="relative z-10 mt-1.5 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[22px] leading-none font-semibold tabular-nums",
            style.text,
          )}
        >
          {value}
        </span>
        {deltaLabel ? (
          <span className="font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
            {deltaLabel}
          </span>
        ) : null}
      </div>

      {/* Spacer pour laisser respirer la sparkline en bas */}
      <div className="relative z-10 mt-2 h-4" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// InlineSparkline — SVG polyline ultra-light, scale auto-adaptatif.
// ---------------------------------------------------------------------------

interface InlineSparklineProps {
  points: Array<number>
  stroke: string
  className?: string
}

const SPARK_W = 120
const SPARK_H = 32

function InlineSparkline({
  points,
  stroke,
  className,
}: InlineSparklineProps): React.JSX.Element {
  const trimmed = points.slice(-60)

  if (trimmed.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className={className}
        aria-hidden
      />
    )
  }

  const max = Math.max(...trimmed, 0.0001)
  const min = Math.min(...trimmed, 0)
  const range = Math.max(max - min, max * 0.1, 0.0001)

  const xStep = SPARK_W / (trimmed.length - 1)

  const pathPoints = trimmed
    .map((v, i) => {
      const x = i * xStep
      const y = SPARK_H - ((v - min) / range) * SPARK_H
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <polyline
        points={pathPoints}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
