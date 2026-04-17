// SPDX-License-Identifier: AGPL-3.0-only
//
// ContainerChart — sparkline interactive basée sur Recharts + shadcn Chart.
// Remplace le MiniChart SVG "muet" : tooltip au survol, area gradient,
// auto-scale, labels timeaxis relatif ("-2m").

import * as React from "react"
import { Area, AreaChart, CartesianGrid, YAxis } from "recharts"

import {
  
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@workspace/ui/components/chart"
import type {ChartConfig} from "@workspace/ui/components/chart";

interface ContainerChartProps {
  /** Valeurs numériques ordonnées du plus ancien au plus récent. */
  points: Array<number>
  /** Intervalle (secondes) entre deux points. Pour le label X de tooltip. */
  stepSeconds?: number
  /** Clé logique utilisée dans le ChartConfig. */
  dataKey: "cpu" | "mem"
  /** Label lisible dans le tooltip. */
  label: string
  /** Couleur CSS (hex/rgb/var). Default = bleu / violet selon dataKey. */
  color?: string
  /** Formatter de valeur pour le tooltip (ex. `42 MB`, `1.2 %`). */
  formatValue?: (v: number) => string
  className?: string
}

const DEFAULT_COLORS: Record<"cpu" | "mem", string> = {
  cpu: "var(--chart-1, #3b82f6)",
  mem: "var(--chart-2, #8b5cf6)",
}

export function ContainerChart({
  points,
  stepSeconds = 5,
  dataKey,
  label,
  color,
  formatValue,
  className,
}: ContainerChartProps): React.JSX.Element {
  const resolvedColor = color ?? DEFAULT_COLORS[dataKey]

  const config: ChartConfig = {
    [dataKey]: {
      label,
      color: resolvedColor,
    },
  }

  // Transforme le ring en data recharts. `t` = secondes avant maintenant (négatif).
  const data = React.useMemo(() => {
    const n = points.length
    return points.map((v, i) => ({
      t: -(n - 1 - i) * stepSeconds,
      [dataKey]: v,
    }))
  }, [points, stepSeconds, dataKey])

  const gradientId = `fill-${dataKey}`

  return (
    <ChartContainer
      config={config}
      className={className ?? "aspect-[3/1] w-full"}
    >
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ top: 4, right: 2, left: 2, bottom: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={resolvedColor} stopOpacity={0.4} />
            <stop offset="95%" stopColor={resolvedColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" opacity={0.3} />
        <YAxis hide domain={[0, "auto"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_label, items) => {
                const t = items[0]?.payload?.t as number | undefined
                if (typeof t !== "number") return ""
                if (t === 0) return "maintenant"
                const s = Math.abs(t)
                if (s < 60) return `il y a ${s}s`
                const m = Math.round(s / 60)
                return `il y a ${m}min`
              }}
              formatter={(value) => {
                const num = typeof value === "number" ? value : Number(value)
                return formatValue ? formatValue(num) : num.toFixed(2)
              }}
            />
          }
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={resolvedColor}
          strokeWidth={1.75}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
