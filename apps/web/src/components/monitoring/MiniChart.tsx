// SPDX-License-Identifier: AGPL-3.0-only

interface MiniChartProps {
  /** Values 0–max (e.g. cpu_pct or mem_ratio * 100). */
  points: Array<number>
  /** Scale ceiling. Defaults to 100. */
  max?: number
  className?: string
  /** Stroke colour (CSS colour string). Defaults to currentColor. */
  stroke?: string
}

const VIEW_W = 60
const VIEW_H = 20
const MAX_POINTS = 60

/**
 * Lightweight SVG sparkline — no runtime dependencies.
 * viewBox "0 0 60 20", height ~32 px via className.
 */
export function MiniChart({
  points,
  max = 100,
  className,
  stroke = "currentColor",
}: MiniChartProps) {
  const trimmed = points.slice(-MAX_POINTS)

  // With fewer than 2 data points, render a flat baseline.
  if (trimmed.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className={className ?? "h-8 w-full"}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={VIEW_H}
          x2={VIEW_W}
          y2={VIEW_H}
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    )
  }

  const n = trimmed.length
  const xStep = VIEW_W / (n - 1)
  const safeMax = max === 0 ? 1 : max

  const polylinePoints = trimmed
    .map((v, i) => {
      const x = i * xStep
      // Invert Y: SVG origin is top-left.
      const y = VIEW_H - (Math.min(v, safeMax) / safeMax) * VIEW_H
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={className ?? "h-8 w-full"}
      aria-hidden="true"
    >
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
