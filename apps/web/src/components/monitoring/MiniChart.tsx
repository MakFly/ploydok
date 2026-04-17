// SPDX-License-Identifier: AGPL-3.0-only

interface MiniChartProps {
  /** Valeurs numériques. L'échelle est auto-scale sauf si `max` est fourni. */
  points: Array<number>
  /**
   * Plafond d'échelle. Si omis → auto-scale sur le max observé × 1.15 (headroom)
   * avec un plancher à `minScale` pour éviter que ~0 paraisse énorme.
   */
  max?: number
  /** Plancher du plafond en mode auto-scale. Default 1. */
  minScale?: number
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
  max,
  minScale = 1,
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
  // Auto-scale: headroom de 15 % au-dessus du max observé; plancher à minScale.
  const observedMax = Math.max(...trimmed)
  const safeMax =
    max !== undefined && max > 0
      ? max
      : Math.max(observedMax * 1.15, minScale)

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
