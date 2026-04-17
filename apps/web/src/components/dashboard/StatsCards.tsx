// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import type { AppListItem } from "../../lib/apps";
import type { Build } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatsCardsProps {
  apps: Array<AppListItem>;
  recentBuilds: Array<Build & { appName: string }>;
  isLoading: boolean;
}

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "green" | "red" | "blue" | "default";
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

const ACCENT_CLASSES: Record<NonNullable<StatCardProps["accent"]>, string> = {
  green: "text-green-600 dark:text-green-400",
  red: "text-destructive",
  blue: "text-blue-600 dark:text-blue-400",
  default: "text-foreground",
};

function StatCard({ label, value, sub, accent = "default", isLoading = false }: StatCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-1">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      {isLoading ? (
        <div className="h-8 w-12 rounded bg-muted animate-pulse" />
      ) : (
        <p className={["text-2xl font-bold tabular-nums", ACCENT_CLASSES[accent]].join(" ")}>
          {value}
        </p>
      )}
      {sub && !isLoading && (
        <p className="text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatsCards
// ---------------------------------------------------------------------------

export function StatsCards({ apps, recentBuilds, isLoading }: StatsCardsProps): React.JSX.Element {
  const totalApps = apps.length;
  const runningApps = apps.filter((a) => a.status === "running").length;
  const failedApps = apps.filter((a) => a.status === "failed").length;

  // Builds today = builds with createdAt in last 24h
  const now = Date.now();
  const buildsToday = recentBuilds.filter((b) => now - b.createdAt < 24 * 60 * 60 * 1000).length;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total apps"
        value={totalApps}
        isLoading={isLoading}
      />
      <StatCard
        label="Running"
        value={runningApps}
        sub={totalApps > 0 ? `${Math.round((runningApps / totalApps) * 100)}% of apps` : undefined}
        accent={runningApps > 0 ? "green" : "default"}
        isLoading={isLoading}
      />
      <StatCard
        label="Failed"
        value={failedApps}
        accent={failedApps > 0 ? "red" : "default"}
        isLoading={isLoading}
      />
      <StatCard
        label="Builds today"
        value={buildsToday}
        accent={buildsToday > 0 ? "blue" : "default"}
        isLoading={isLoading}
      />
    </div>
  );
}
