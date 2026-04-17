// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { RiAddLine, RiArrowRightUpLine, RiGitBranchLine, RiGlobalLine } from "@remixicon/react";
import type { AppStatus } from "@ploydok/shared";
import { CreateAppModal } from "../../../components/apps/CreateAppModal";
import { ShellPage, ShellPanel } from "../../../components/layout/AppShell";
import type { AppListItem } from "../../../lib/apps";
import { useApps } from "../../../lib/apps";
import { useGitHubAppConfig } from "../../../lib/github";

export const Route = createFileRoute("/_authed/apps/")({
  component: AppsPage,
});

function AppsPage(): React.JSX.Element {
  const [modalOpen, setModalOpen] = React.useState(false);
  const { data: apps = [], isLoading, error } = useApps();
  const { data: appConfig } = useGitHubAppConfig();

  return (
    <ShellPage
      title="Applications"
      description="Tes applications déployées — build, run et monitoring depuis un seul endroit."
      eyebrow="Workspace"
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/github">GitHub setup</Link>
          </Button>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <RiAddLine className="size-4" />
            New app
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.9fr_1fr]">
        <ShellPanel
          title="Application roster"
          description="Every card keeps the softer, inset visual language of the reference shell while exposing real deployment state."
        >
          {isLoading ? (
            <AppsGridSkeleton />
          ) : error ? (
            <p className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
              Failed to load apps: {error.message}
            </p>
          ) : apps.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {apps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          ) : (
            <EmptyState
              isGitHubConnected={appConfig?.configured ?? false}
              onCreateApp={() => setModalOpen(true)}
            />
          )}
        </ShellPanel>

        <div className="grid gap-4">
          <ShellPanel title="Flow" description="The right rail mirrors the action-first style from Efferd.">
            <div className="space-y-3">
              <MiniStep
                label="Connect GitHub"
                body={appConfig?.configured ? "GitHub App is already configured." : "Install the GitHub App to unlock repository selection."}
                to="/settings/github"
              />
              <MiniButton
                label="Create a new app"
                body="Open the modal and start from a repository or template."
                onClick={() => setModalOpen(true)}
              />
              <MiniStep
                label="Review the guide"
                body="Operational notes for app setup and callback flow."
                to="/guide"
              />
            </div>
          </ShellPanel>

          <ShellPanel title="Snapshot" description="A lightweight summary for this area.">
            <div className="grid gap-3">
              <SnapshotRow label="Total apps" value={String(apps.length)} />
              <SnapshotRow label="Running" value={String(apps.filter((app) => app.status === "running").length)} />
              <SnapshotRow label="GitHub" value={appConfig?.configured ? "Connected" : "Pending"} />
            </div>
          </ShellPanel>
        </div>
      </div>

      <CreateAppModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </ShellPage>
  );
}

function AppCard({ app }: { app: AppListItem }): React.JSX.Element {
  return (
    <Link
      to="/apps/$id/overview"
      params={{ id: app.id }}
      className="rounded-[1.5rem] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,248,250,0.94))] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_35px_rgba(148,163,184,0.18)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{app.name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {app.repoFullName ?? "Repository pending"}
          </p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <RiGitBranchLine className="size-4" />
          <span>{app.branch ?? "main"}</span>
        </div>
        <div className="flex items-center gap-2">
          <RiGlobalLine className="size-4" />
          <span className="truncate">{app.domain ?? "Domain pending"}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-4">
        <span className="text-xs text-muted-foreground">Open deployment</span>
        <RiArrowRightUpLine className="size-4 text-slate-500" />
      </div>
    </Link>
  );
}

const STATUS_STYLES: Record<AppStatus, string> = {
  created: "bg-slate-200 text-slate-700",
  pending: "bg-slate-200 text-slate-700",
  building: "bg-sky-500/12 text-sky-700",
  running: "bg-emerald-500/12 text-emerald-700",
  failed: "bg-destructive/10 text-destructive",
  stopped: "bg-slate-200 text-slate-700",
};

function StatusBadge({ status }: { status: AppStatus }): React.JSX.Element {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] ?? STATUS_STYLES.pending,
      ].join(" ")}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {status}
    </span>
  );
}

function EmptyState({
  isGitHubConnected,
  onCreateApp,
}: {
  isGitHubConnected: boolean;
  onCreateApp: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-white/70 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-950">No applications yet</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {isGitHubConnected
          ? "Start the first deployment and this grid will take over the canvas."
          : "Connect GitHub first so Ploydok can read repositories and create deployments."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {isGitHubConnected ? (
          <Button size="sm" onClick={onCreateApp}>
            Create app
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/github">Connect GitHub</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function AppsGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-[1.5rem] border border-border/70 bg-white/85 p-4 shadow-sm"
        >
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-44 rounded bg-slate-100" />
          <div className="mt-6 h-3 w-20 rounded bg-slate-100" />
          <div className="mt-2 h-3 w-28 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function MiniStep({
  label,
  body,
  to,
}: {
  label: string;
  body: string;
  to: string;
}): React.JSX.Element {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-[1.15rem] border border-border/70 bg-white/80 px-4 py-3 transition-colors hover:border-slate-300"
    >
      <span>
        <span className="block text-sm font-medium text-slate-950">{label}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-slate-500" />
    </Link>
  );
}

function MiniButton({
  label,
  body,
  onClick,
}: {
  label: string;
  body: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-[1.15rem] border border-border/70 bg-white/80 px-4 py-3 text-left transition-colors hover:border-slate-300"
    >
      <span>
        <span className="block text-sm font-medium text-slate-950">{label}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-slate-500" />
    </button>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-[1rem] border border-border/70 bg-white/80 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}
