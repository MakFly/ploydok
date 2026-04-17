// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import type { AppStatus } from "@ploydok/shared";

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
    className:
      "bg-green-500/10 text-green-600 dark:text-green-400",
    pulse: false,
  },
  building: {
    label: "Building",
    className:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400",
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
};

// ---------------------------------------------------------------------------
// AppStatusBadge
// ---------------------------------------------------------------------------

interface AppStatusBadgeProps {
  status: AppStatus;
  className?: string;
}

export function AppStatusBadge({
  status,
  className,
}: AppStatusBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.className,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={`App status: ${config.label}`}
    >
      <span
        className={[
          "size-1.5 rounded-full bg-current",
          config.pulse ? "animate-pulse" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}
