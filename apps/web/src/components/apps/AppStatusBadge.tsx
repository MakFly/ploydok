// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import type { AppStatus } from "@ploydok/shared"
import type { TFunction } from "i18next"

// ---------------------------------------------------------------------------
// Styles per status
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<
  AppStatus,
  { className: string; pulse: boolean }
> = {
  created: {
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
  running: {
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  serving: {
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    pulse: false,
  },
  building: {
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    pulse: true,
  },
  restarting: {
    className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    pulse: true,
  },
  deleting: {
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    pulse: true,
  },
  failed: {
    className: "bg-destructive/10 text-destructive",
    pulse: false,
  },
  stopped: {
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
  pending: {
    className: "bg-muted text-muted-foreground",
    pulse: false,
  },
}

function statusLabel(status: AppStatus, t: TFunction<"apps">): string {
  const key = `status.${status}` as const
  return t(key)
}

// ---------------------------------------------------------------------------
// AppStatusBadge
// ---------------------------------------------------------------------------

type Health = "healthy" | "unhealthy"

const HEALTH_STYLE: Record<
  Health,
  { className: string; pulse: boolean }
> = {
  healthy: {
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  unhealthy: {
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
  const { t } = useTranslation("apps")
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.pending
  const label = statusLabel(status, t)
  const healthStyle = health ? HEALTH_STYLE[health] : null
  const healthLabel = health ? t(`status.${health}`) : null

  return (
    <span
      className={["inline-flex shrink-0 items-center gap-1.5", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Pill
        label={label}
        className={style.className}
        pulse={style.pulse}
        ariaLabel={t("status.aria", { label })}
      />
      {healthStyle && healthLabel ? (
        <Pill
          label={healthLabel}
          className={healthStyle.className}
          pulse={healthStyle.pulse}
          ariaLabel={t("status.healthAria", { label: healthLabel })}
        />
      ) : null}
    </span>
  )
}
