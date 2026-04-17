// SPDX-License-Identifier: AGPL-3.0-only
import { healthClass } from "@ploydok/shared"
import type { ContainerStatus } from "@ploydok/shared"

interface StatusDotProps {
  status: ContainerStatus
  className?: string
}

const colorMap: Record<"healthy" | "warn" | "down", string> = {
  healthy: "bg-emerald-500 animate-pulse",
  warn: "bg-amber-500",
  down: "bg-red-500",
}

export function StatusDot({ status, className }: StatusDotProps) {
  // Build a minimal snapshot to reuse the shared healthClass helper.
  const cls = healthClass({
    id: "",
    name: "",
    image: "",
    status,
    uptime_s: 0,
    cpu_pct: 0,
    mem_bytes: 0,
    mem_limit_bytes: 0,
    restart_count: 0,
    last_seen_ms: 0,
  })

  const colorCls = colorMap[cls]

  return (
    <span
      className={[
        "inline-block size-2.5 rounded-full",
        colorCls,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  )
}
