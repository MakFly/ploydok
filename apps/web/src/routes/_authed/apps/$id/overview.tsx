// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { apiFetch } from "../../../../lib/api";
import { useApp } from "../../../../lib/apps";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/overview")({
  component: AppOverviewTab,
});

// ---------------------------------------------------------------------------
// AppOverviewTab
// ---------------------------------------------------------------------------

function AppOverviewTab(): React.JSX.Element {
  const { id } = Route.useParams();
  const { data: app, isLoading, error } = useApp(id);

  if (isLoading) return <OverviewSkeleton />;
  if (error || !app) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load app: {error?.message ?? "Not found"}
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <InfoCard label="Status" value={app.status} />
      <InfoCard label="Branch" value={app.branch ?? "—"} />
      <InfoCard label="Repository" value={app.repoFullName ?? "—"} />
      <InfoCard label="Domain" value={app.domain ?? "—"} />
      <InfoCard
        label="Current commit"
        value={
          app.currentCommitSha
            ? app.currentCommitSha.slice(0, 7)
            : "—"
        }
        mono
      />
      <InfoCard
        label="Last build"
        value={app.latestBuildId ?? "No builds yet"}
        mono={Boolean(app.latestBuildId)}
      />
      <InfoCard
        label="Build method"
        value={app.buildMethod ?? "auto"}
      />
      <InfoCard
        label="Root dir"
        value={app.rootDir ?? "/"}
        mono
      />

      {/* [M4.2 registry — BEGIN] */}
      <RegistryUsageWidget appId={id} />
      {/* [M4.2 registry — END] */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InfoCard
// ---------------------------------------------------------------------------

interface InfoCardProps {
  label: string;
  value: string;
  mono?: boolean;
}

function InfoCard({ label, value, mono }: InfoCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p
        className={[
          "text-sm truncate",
          mono ? "font-mono" : "font-medium",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function OverviewSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
      {[...Array<null>(8)].map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-4 space-y-2"
        >
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// [M4.2 registry — BEGIN] Registry storage widget
// ---------------------------------------------------------------------------

interface RegistryUsage {
  tags: number;
  bytes: number;
  diskPct: number;
}

interface GcResult {
  reposScanned: number;
  tagsDeleted: number;
  bytesFreed: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function useRegistryUsage(appId: string) {
  return useQuery<RegistryUsage, Error>({
    queryKey: ["apps", appId, "registry-usage"],
    queryFn: () => apiFetch<RegistryUsage>(`/apps/${appId}/registry-usage`),
    staleTime: 30_000,
    enabled: Boolean(appId),
  });
}

function useRegistryGc(appId: string) {
  const qc = useQueryClient();
  return useMutation<GcResult, Error, void>({
    mutationFn: () =>
      apiFetch<GcResult>(`/apps/${appId}/registry-gc`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId, "registry-usage"] });
    },
  });
}

interface RegistryUsageWidgetProps {
  appId: string;
}

function RegistryUsageWidget({ appId }: RegistryUsageWidgetProps): React.JSX.Element {
  const { data, isLoading, error } = useRegistryUsage(appId);
  const gc = useRegistryGc(appId);

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Toast-like result message
  const [toast, setToast] = React.useState<{ ok: boolean; msg: string } | null>(null);

  const handlePrune = async (): Promise<void> => {
    setConfirmOpen(false);
    setToast(null);
    try {
      const result = await gc.mutateAsync();
      setToast({
        ok: true,
        msg: `Pruned ${result.tagsDeleted} image(s) across ${result.reposScanned} repo(s).`,
      });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "GC failed" });
    }
  };

  // Dismiss toast after 5 s
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5_000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 sm:col-span-2 lg:col-span-1">
      {/* Header */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Registry storage
      </p>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-5 w-24 rounded bg-muted" />
          <div className="h-2 w-full rounded bg-muted" />
        </div>
      )}

      {error && !isLoading && (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
        </p>
      )}

      {data && !isLoading && (
        <>
          {/* Stats row */}
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums">{data.tags}</span>
            <span className="text-xs text-muted-foreground">
              image{data.tags !== 1 ? "s" : ""}
            </span>
            {data.bytes > 0 && (
              <span className="ml-auto text-xs text-muted-foreground font-mono">
                {formatBytes(data.bytes)}
              </span>
            )}
          </div>

          {/* Disk usage progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Disk usage</span>
              <span>{data.diskPct}%</span>
            </div>
            {/* Progress bar (inline — no shadcn Progress component available) */}
            <div
              className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={data.diskPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={[
                  "h-full rounded-full transition-all",
                  data.diskPct >= 80
                    ? "bg-destructive"
                    : data.diskPct >= 60
                    ? "bg-yellow-500"
                    : "bg-primary",
                ].join(" ")}
                style={{ width: `${Math.min(data.diskPct, 100)}%` }}
              />
            </div>
          </div>
        </>
      )}

      {/* Toast feedback */}
      {toast && (
        <p
          className={[
            "text-xs rounded px-2 py-1",
            toast.ok
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-destructive/10 text-destructive",
          ].join(" ")}
          role="status"
        >
          {toast.msg}
        </p>
      )}

      {/* Prune button */}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={gc.isPending || isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {gc.isPending ? "Pruning…" : "Prune now"}
      </Button>

      {/* Inline confirm dialog (no Dialog component available) */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prune-dialog-title"
        >
          <div className="rounded-lg border border-border bg-popover p-5 shadow-lg w-full max-w-sm space-y-4">
            <h2
              id="prune-dialog-title"
              className="text-sm font-semibold"
            >
              Prune registry images?
            </h2>
            <p className="text-xs text-muted-foreground">
              This will delete all but the 3 most recent images for this app.
              Running containers are not affected.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handlePrune()}
              >
                Prune
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// [M4.2 registry — END]
