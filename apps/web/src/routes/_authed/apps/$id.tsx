// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { AppStatusBadge } from "../../../components/apps/AppStatusBadge";
import { apiFetch } from "../../../lib/api";
import {
  useApp,
  useDeployApp,
  useRestartApp,
  useRollbackApp,
  useStopApp,
} from "../../../lib/apps";
import type { AppDetail } from "../../../lib/apps";

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id")({
  loader: async ({ params }): Promise<{ app: AppDetail }> => {
    const { app } = await apiFetch<{ app: AppDetail; builds: unknown[] }>(
      `/apps/${params.id}`,
    );
    return { app };
  },
  component: AppDetailLayout,
});

// ---------------------------------------------------------------------------
// Tabs configuration
// ---------------------------------------------------------------------------

const TABS = [
  { label: "Overview", to: "/apps/$id/overview" },
  { label: "Logs", to: "/apps/$id/logs" },
  { label: "Builds", to: "/apps/$id/builds" },
  { label: "Settings", to: "/apps/$id/settings" },
  { label: "Env", to: "/apps/$id/env" },
  { label: "Domains", to: "/apps/$id/domains" },
] as const;

const TAB_LINK_CLASS =
  "rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-b-2 [&.active]:border-primary [&.active]:text-foreground transition-colors";

// ---------------------------------------------------------------------------
// AppDetailLayout
// ---------------------------------------------------------------------------

function AppDetailLayout(): React.JSX.Element {
  const { id } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const { data: app } = useApp(id);

  // Prefer live data from query, fall back to loader snapshot
  const currentApp = app ?? loaderData.app;

  const deploy = useDeployApp(id);
  const rollback = useRollbackApp(id);
  const stop = useStopApp(id);
  const restart = useRestartApp(id);

  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionsOpen]);

  const handleDeploy = async (): Promise<void> => {
    setActionError(null);
    try {
      await deploy.mutateAsync();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Deploy failed");
    }
  };

  const handleRollback = async (): Promise<void> => {
    setActionsOpen(false);
    setActionError(null);
    const latestBuildId = currentApp.latestBuildId;
    if (!latestBuildId) {
      setActionError("No build to roll back to");
      return;
    }
    try {
      await rollback.mutateAsync({ buildId: latestBuildId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rollback failed");
    }
  };

  const handleStop = async (): Promise<void> => {
    setActionsOpen(false);
    setActionError(null);
    try {
      await stop.mutateAsync();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Stop failed");
    }
  };

  const handleRestart = async (): Promise<void> => {
    setActionsOpen(false);
    setActionError(null);
    try {
      await restart.mutateAsync();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Restart failed");
    }
  };

  const isBusy =
    deploy.isPending || rollback.isPending || stop.isPending || restart.isPending;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                           */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link to="/apps" className="transition-colors hover:text-slate-900">
                Apps
              </Link>
              <ChevronIcon className="size-3" />
              <span className="truncate font-medium text-slate-900">
                {currentApp.name}
              </span>
            </div>

            {/* Title + badge */}
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold truncate">{currentApp.name}</h1>
              <AppStatusBadge status={currentApp.status} />
            </div>

            {/* Meta */}
            {(currentApp.repoFullName ?? currentApp.domain) && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {currentApp.repoFullName && (
                  <span className="flex items-center gap-1">
                    <RepoIcon className="size-3" />
                    {currentApp.repoFullName}
                    {currentApp.branch && (
                      <span className="text-muted-foreground/60">
                        &nbsp;({currentApp.branch})
                      </span>
                    )}
                  </span>
                )}
                {currentApp.domain && (
                  <a
                    href={`https://${currentApp.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 transition-colors hover:text-slate-900 hover:underline"
                  >
                    <GlobeIcon className="size-3" />
                    {currentApp.domain}
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {actionError && (
              <span className="text-xs text-destructive max-w-[200px] truncate" role="alert">
                {actionError}
              </span>
            )}

            {/* Deploy button */}
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => void handleDeploy()}
            >
              {deploy.isPending ? "Deploying…" : "Deploy"}
            </Button>

            {/* Actions dropdown */}
            <div className="relative" ref={dropdownRef}>
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => setActionsOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
              >
                Actions
                <ChevronDownIcon className="size-3.5 ml-1" />
              </Button>

              {actionsOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 w-40 rounded-md border border-border bg-popover shadow-md"
                  role="menu"
                >
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    role="menuitem"
                    onClick={() => void handleRollback()}
                    disabled={isBusy}
                  >
                    Rollback
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    role="menuitem"
                    onClick={() => void handleStop()}
                    disabled={isBusy}
                  >
                    Stop
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    role="menuitem"
                    onClick={() => void handleRestart()}
                    disabled={isBusy}
                  >
                    Restart
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Tabs nav                                                          */}
        {/* ---------------------------------------------------------------- */}
        <nav
          className="flex gap-1 border-b border-border"
          aria-label="App sections"
        >
          {TABS.map((tab) => (
            <Link
              key={tab.label}
              to={tab.to}
              params={{ id }}
              className={TAB_LINK_CLASS}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {/* ---------------------------------------------------------------- */}
        {/* Child route outlet                                               */}
        {/* ---------------------------------------------------------------- */}
        <Outlet />
      </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function RepoIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}
