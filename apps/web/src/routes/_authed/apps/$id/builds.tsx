// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BuildLogViewer } from "../../../../components/apps/BuildLogViewer";
import { useBuilds } from "../../../../lib/apps";
import type { Build, BuildStatus } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/builds")({
  component: AppBuildsTab,
});

// ---------------------------------------------------------------------------
// Status badge styles
// ---------------------------------------------------------------------------

const BUILD_STATUS_CLASS: Record<BuildStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  succeeded: "bg-green-500/10 text-green-600 dark:text-green-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

// ---------------------------------------------------------------------------
// AppBuildsTab
// ---------------------------------------------------------------------------

function AppBuildsTab(): React.JSX.Element {
  const { id } = Route.useParams();
  const { data: builds, isLoading, error } = useBuilds(id);
  const [selectedBuildId, setSelectedBuildId] = React.useState<string | null>(null);

  if (isLoading) return <BuildsSkeleton />;
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load builds: {error.message}
      </p>
    );
  }

  if (!builds || builds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
        <p className="text-sm font-medium mb-1">No builds yet</p>
        <p className="text-sm text-muted-foreground">
          Trigger a deploy to start your first build.
        </p>
      </div>
    );
  }

  const selectedBuild = builds.find((b) => b.id === selectedBuildId);

  return (
    <div className="space-y-4">
      {/* Builds table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                Build ID
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                Status
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                Commit
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                Method
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                Duration
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                Started
              </th>
            </tr>
          </thead>
          <tbody>
            {builds.map((build) => (
              <BuildRow
                key={build.id}
                build={build}
                selected={selectedBuildId === build.id}
                onSelect={() =>
                  setSelectedBuildId(
                    selectedBuildId === build.id ? null : build.id,
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Log detail panel */}
      {selectedBuild && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Build logs — {selectedBuild.id.slice(0, 8)}
            </h3>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedBuildId(null)}
            >
              Close
            </button>
          </div>
          <BuildLogViewer
            appId={id}
            buildId={selectedBuild.id}
            className="min-h-[300px]"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuildRow
// ---------------------------------------------------------------------------

interface BuildRowProps {
  build: Build;
  selected: boolean;
  onSelect: () => void;
}

function BuildRow({ build, selected, onSelect }: BuildRowProps): React.JSX.Element {
  const duration = formatDuration(build.startedAt, build.finishedAt);
  const startedAt = build.startedAt
    ? new Date(build.startedAt).toLocaleString()
    : "—";

  return (
    <tr
      className={[
        "border-b border-border/60 last:border-0 cursor-pointer transition-colors",
        selected ? "bg-muted/60" : "hover:bg-muted/30",
      ].join(" ")}
      onClick={onSelect}
      role="button"
      aria-selected={selected}
      aria-label={`Build ${build.id}, status ${build.status}`}
    >
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {build.id.slice(0, 8)}
      </td>
      <td className="px-4 py-3">
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
            BUILD_STATUS_CLASS[build.status],
          ].join(" ")}
        >
          {build.status}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-xs">
        {build.commitSha ? build.commitSha.slice(0, 7) : "—"}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {build.buildMethod}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {duration}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {startedAt}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return "—";
  const diff = ((endMs ?? Date.now()) - startMs) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  const m = Math.floor(diff / 60);
  const s = Math.round(diff % 60);
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function BuildsSkeleton(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border overflow-hidden animate-pulse">
      <div className="h-10 bg-muted/40" />
      {[...Array<null>(3)].map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-t border-border/60">
          <div className="h-4 w-20 rounded bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-4 w-12 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
