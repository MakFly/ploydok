// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { RiArrowRightUpLine, RiGitRepositoryLine, RiShieldCheckLine, RiSparklingLine } from "@remixicon/react";
import { CreateAppModal } from "../../components/apps/CreateAppModal";
import { SecondFactorBanner } from "../../components/auth/SecondFactorBanner";
import { ShellPage, ShellPanel } from "../../components/layout/AppShell";
import { useApps, useRecentBuildsAcrossApps } from "../../lib/apps";
import { useGitHubAppConfig } from "../../lib/github";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage(): React.JSX.Element {
  const { me } = Route.useRouteContext();
  const [modalOpen, setModalOpen] = React.useState(false);
  const { data: apps = [], isLoading: appsLoading, error: appsError } = useApps();
  const { builds: recentBuilds, isLoading: buildsLoading } = useRecentBuildsAcrossApps(apps, 6);
  const { data: appConfig } = useGitHubAppConfig();

  const runningApps = apps.filter((app) => app.status === "running").length;
  const secureAccount = me.has_passkey_plus && me.has_backup_codes;
  const latestBuild = recentBuilds[0];

  return (
    <ShellPage
      title={`Hey There! ${me.display_name.split(" ")[0]}`}
      description="Welcome back. This workspace view mirrors the Efferd shell language while keeping your real Ploydok data in play."
      eyebrow="Workspace Overview"
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/github">Review integrations</Link>
          </Button>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            New app
          </Button>
        </>
      }
    >
      <SecondFactorBanner me={me} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Running apps"
          value={appsLoading ? "..." : String(runningApps)}
          detail={appsLoading ? "Syncing deployment state" : `${apps.length} total services`}
          tone="dark"
        />
        <MetricCard
          label="GitHub app"
          value={appConfig?.configured ? "Connected" : "Missing"}
          detail={appConfig?.configured ? appConfig.name ?? "Manifest installed" : "Set up the app to deploy from repos"}
          tone={appConfig?.configured ? "light" : "warning"}
        />
        <MetricCard
          label="Security posture"
          value={secureAccount ? "Hardened" : "Action needed"}
          detail={secureAccount ? "Passkeys and recovery codes are in place" : "Finish second-factor setup"}
          tone={secureAccount ? "success" : "warning"}
        />
        <MetricCard
          label="Latest build"
          value={latestBuild ? latestBuild.status : buildsLoading ? "..." : "None"}
          detail={latestBuild ? latestBuild.appName : "No builds observed yet"}
          tone="light"
        />
      </div>

      {appsError ? (
        <div
          role="alert"
          className="rounded-[1.5rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Failed to load apps: {appsError.message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        <ShellPanel
          title="Workspace surface"
          description="The shell keeps the wide, modular rhythm from the reference while grounding it in deployment data."
        >
          <div className="grid gap-4 md:grid-cols-4">
            <SurfaceBlock className="md:col-span-2" title="Application roster">
              {appsLoading ? (
                <PlaceholderRows />
              ) : apps.length > 0 ? (
                <div className="space-y-2">
                  {apps.slice(0, 4).map((app) => (
                    <Link
                      key={app.id}
                      to="/apps/$id/overview"
                      params={{ id: app.id }}
                      className="flex items-center justify-between rounded-[1rem] border border-border/70 bg-white/85 px-4 py-3 transition-colors hover:border-slate-300"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-950">{app.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {app.repoFullName ?? "No repository linked"}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium capitalize text-white">
                        {app.status}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyCopy
                  title="No deployments yet"
                  body="Create your first application to replace these placeholder blocks with live rollout data."
                />
              )}
            </SurfaceBlock>

            <SurfaceBlock title="Quick stack">
              <div className="grid gap-3">
                <MiniTile
                  icon={<RiGitRepositoryLine className="size-4" />}
                  label="Repositories"
                  value={appConfig?.configured ? "Connected" : "Pending"}
                />
                <MiniTile
                  icon={<RiShieldCheckLine className="size-4" />}
                  label="Account"
                  value={secureAccount ? "Protected" : "Review"}
                />
                <MiniTile
                  icon={<RiSparklingLine className="size-4" />}
                  label="Guide"
                  value="Playbook ready"
                />
              </div>
            </SurfaceBlock>

            <SurfaceBlock className="md:col-span-3 min-h-[20rem]" title="Recent delivery activity">
              {buildsLoading ? (
                <PlaceholderRows rows={4} />
              ) : recentBuilds.length > 0 ? (
                <div className="grid gap-3">
                  {recentBuilds.slice(0, 5).map((build) => (
                    <div
                      key={build.id}
                      className="flex flex-col gap-2 rounded-[1rem] border border-border/70 bg-white/85 px-4 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-950">{build.appName}</p>
                        <p className="text-xs text-muted-foreground">
                          {build.commitSha ? build.commitSha.slice(0, 7) : "manual"} · {build.status}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        {new Date(build.createdAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyCopy
                  title="No builds yet"
                  body="When new builds land, this panel becomes the activity stream in the shell."
                />
              )}
            </SurfaceBlock>
          </div>
        </ShellPanel>

        <div className="grid gap-4">
          <ShellPanel
            title="Quick actions"
            description="Keep the right rail practical instead of decorative."
          >
            <div className="grid gap-3">
              <ActionLink to="/apps" label="Browse apps" note="Inspect deployments, logs and tabs." />
              <ActionButton
                label="Create a new app"
                note="Start the repository flow from the modal."
                onClick={() => setModalOpen(true)}
              />
              <ActionLink to="/guide" label="Open the guide" note="Operational notes and GitHub app setup." />
              <ActionLink
                to="/settings/security"
                label="Review security"
                note="Passkeys, sessions and account hardening."
              />
            </div>
          </ShellPanel>

          <ShellPanel
            title="Shell notes"
            description="What changed in this port from the original static reference."
          >
            <ul className="space-y-3 text-sm leading-6 text-slate-600">
              <li className="rounded-[1rem] border border-border/60 bg-white/70 px-4 py-3">
                The cloned shell grammar now wraps the authenticated router instead of living as a standalone HTML mirror.
              </li>
              <li className="rounded-[1rem] border border-border/60 bg-white/70 px-4 py-3">
                Dashboard surfaces are now backed by real Ploydok queries instead of static placeholder markup.
              </li>
              <li className="rounded-[1rem] border border-border/60 bg-white/70 px-4 py-3">
                The right rail and sidebar map the Efferd navigation language onto your existing `_authed` routes.
              </li>
            </ul>
          </ShellPanel>
        </div>
      </div>

      <CreateAppModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </ShellPage>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "dark" | "light" | "success" | "warning";
}): React.JSX.Element {
  return (
    <div
      className={[
        "rounded-[1.6rem] border px-5 py-4 shadow-sm",
        tone === "dark" && "border-slate-900 bg-slate-900 text-white",
        tone === "light" && "border-border/70 bg-white/90 text-slate-900",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-950",
      ].join(" ")}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] opacity-70">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-sm opacity-80">{detail}</p>
    </div>
  );
}

function SurfaceBlock({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={["rounded-[1.4rem] border border-border/70 bg-[#f3f5f8] p-4", className].filter(Boolean).join(" ")}>
      <p className="mb-3 text-sm font-medium text-slate-700">{title}</p>
      {children}
    </div>
  );
}

function MiniTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-[1rem] border border-border/70 bg-white/85 px-4 py-3">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-xs uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PlaceholderRows({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-[1rem] border border-border/60 bg-white/75 px-4 py-3">
          <div className="h-3 w-32 rounded bg-slate-200" />
          <div className="mt-2 h-2.5 w-48 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyCopy({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="rounded-[1rem] border border-dashed border-border bg-white/60 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function ActionLink({
  to,
  label,
  note,
}: {
  to: string;
  label: string;
  note: string;
}): React.JSX.Element {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-[1.15rem] border border-border/70 bg-white/80 px-4 py-3 transition-colors hover:border-slate-300"
    >
      <span>
        <span className="block text-sm font-medium text-slate-950">{label}</span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-slate-500" />
    </Link>
  );
}

function ActionButton({
  label,
  note,
  onClick,
}: {
  label: string;
  note: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-[1.15rem] border border-border/70 bg-white/80 px-4 py-3 text-left transition-colors hover:border-slate-300"
    >
      <span>
        <span className="block text-sm font-medium text-slate-950">{label}</span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-slate-500" />
    </button>
  );
}
