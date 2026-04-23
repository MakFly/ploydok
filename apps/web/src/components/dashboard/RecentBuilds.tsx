// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { organizationPath, useCurrentOrganizationSlug } from "../../lib/organizations";
import type { BuildStatus } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildRow {
  buildId: string;
  appId: string;
  appName: string;
  status: BuildStatus;
  commitSha?: string;
  startedAt?: number;
  createdAt: number;
}

interface RecentBuildsProps {
  builds: Array<BuildRow>;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<BuildStatus, string> = {
  pending: "bg-muted-foreground",
  running: "bg-blue-500 animate-pulse",
  succeeded: "bg-green-500",
  succeeded_with_warning: "bg-amber-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

const STATUS_TEXT: Record<BuildStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-600 dark:text-blue-400",
  succeeded: "text-green-600 dark:text-green-400",
  succeeded_with_warning: "text-amber-600 dark:text-amber-400",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

function timeAgo(tsMs: number): string {
  const diff = Date.now() - tsMs;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// RecentBuilds
// ---------------------------------------------------------------------------

export function RecentBuilds({ builds, isLoading }: RecentBuildsProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Recent builds
      </p>
      {isLoading ? (
        <RecentBuildsSkeleton />
      ) : builds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center">
          <p className="text-sm text-muted-foreground">No builds yet</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
          {builds.slice(0, 5).map((build) => (
            <BuildItem key={build.buildId} build={build} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuildItem
// ---------------------------------------------------------------------------

function BuildItem({ build }: { build: BuildRow }): React.JSX.Element {
  const ts = build.startedAt ?? build.createdAt;
  const sha = build.commitSha ? build.commitSha.slice(0, 7) : null;
  const orgSlug = useCurrentOrganizationSlug()

  return (
    <Link
      to={(orgSlug ? organizationPath(orgSlug, `apps/${build.appId}/overview`) : `/apps/${build.appId}/overview`) as never}
      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Status dot */}
      <span
        className={["size-2 rounded-full shrink-0", STATUS_DOT[build.status]].join(" ")}
        aria-hidden="true"
      />

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">
          <span className={STATUS_TEXT[build.status]}>{build.appName}</span>
          {sha && (
            <span className="text-muted-foreground font-mono"> · {sha}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{timeAgo(ts)}</p>
      </div>

      {/* Status label */}
      <span className={["text-xs font-medium shrink-0", STATUS_TEXT[build.status]].join(" ")}>
        {build.status}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RecentBuildsSkeleton(): React.JSX.Element {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden animate-pulse">
      {[...Array<null>(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="size-2 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-2.5 w-16 rounded bg-muted" />
          </div>
          <div className="h-3 w-14 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
