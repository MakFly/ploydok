// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import type { DbHealthStatus, DbStatus } from "../../lib/databases"

const STATUS_CONFIG: Record<
  DbStatus,
  { label: string; className: string; pulse: boolean }
> = {
  creating: {
    label: "Creating",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    pulse: true,
  },
  starting: {
    label: "Starting",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    pulse: true,
  },
  running: {
    label: "Running",
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  stopped: {
    label: "Stopped",
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
  degraded: {
    label: "Degraded",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    pulse: true,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive",
    pulse: false,
  },
}

const HEALTH_CONFIG: Record<
  DbHealthStatus,
  { label: string; className: string; pulse: boolean }
> = {
  unknown: {
    label: "Unknown",
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
  starting: {
    label: "Starting",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    pulse: true,
  },
  healthy: {
    label: "Healthy",
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  degraded: {
    label: "Degraded",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    pulse: true,
  },
  unhealthy: {
    label: "Unhealthy",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    pulse: true,
  },
}

interface DatabaseStatusBadgeProps {
  status: DbStatus
  health?: DbHealthStatus | null
  className?: string
}

function Pill({
  label,
  className,
  pulse,
  ariaLabel,
}: {
  label: string
  className: string
  pulse: boolean
  ariaLabel: string
}): React.JSX.Element {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={ariaLabel}
    >
      <span
        className={[
          "size-1.5 rounded-full bg-current",
          pulse ? "animate-pulse" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}

export function DatabaseStatusBadge({
  status,
  health,
  className,
}: DatabaseStatusBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.stopped
  const healthCfg = health ? HEALTH_CONFIG[health] : null

  return (
    <span
      className={["inline-flex shrink-0 items-center gap-1.5", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Pill
        label={config.label}
        className={config.className}
        pulse={config.pulse}
        ariaLabel={`Database status: ${config.label}`}
      />
      {healthCfg ? (
        <Pill
          label={healthCfg.label}
          className={healthCfg.className}
          pulse={healthCfg.pulse}
          ariaLabel={`Database health: ${healthCfg.label}`}
        />
      ) : null}
    </span>
  )
}
