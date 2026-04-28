// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import type { AppStatus } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Styles per status
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  AppStatus,
  { label: string; className: string; pulse: boolean }
> = {
  created: {
    label: "Created",
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
  running: {
    label: "Running",
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  serving: {
    label: "Serving",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    pulse: false,
  },
  building: {
    label: "Building",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    pulse: true,
  },
  restarting: {
    label: "Restarting",
    className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    pulse: true,
  },
  deleting: {
    label: "Deleting",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    pulse: true,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive",
    pulse: false,
  },
  stopped: {
    label: "Stopped",
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
  pending: {
    label: "Pending",
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
}

// ---------------------------------------------------------------------------
// AppStatusBadge
// ---------------------------------------------------------------------------

type Health = "healthy" | "unhealthy"

const HEALTH_CONFIG: Record<
  Health,
  { label: string; className: string; pulse: boolean }
> = {
  healthy: {
    label: "Healthy",
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  unhealthy: {
    label: "Unhealthy",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    pulse: true,
  },
}

interface AppStatusBadgeProps {
  status: AppStatus
  health?: Health | null
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

export function AppStatusBadge({
  status,
  health,
  className,
}: AppStatusBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
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
        ariaLabel={`App status: ${config.label}`}
      />
      {healthCfg ? (
        <Pill
          label={healthCfg.label}
          className={healthCfg.className}
          pulse={healthCfg.pulse}
          ariaLabel={`App health: ${healthCfg.label}`}
        />
      ) : null}
    </span>
  )
}
