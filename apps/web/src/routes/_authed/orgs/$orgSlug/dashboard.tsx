// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  RiAddLine,
  RiAppsLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiGithubFill,
  RiPlayCircleLine,
  RiPulseFill,
  RiTimeLine,
} from "@remixicon/react"
import { CreateAppModal } from "../../../../components/apps/CreateAppModal"
import { GettingStartedPanel } from "../../../../components/apps/GettingStartedPanel"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"
import {
  resolveRuntimeAppStatus,
  selectAppSnapshot,
} from "../../../../lib/app-runtime"
import { useApps, useRecentBuildsAcrossApps } from "../../../../lib/apps"
import { useGitHubAppConfig } from "../../../../lib/github"
import { useMonitoring } from "../../../../lib/monitoring"
import {
  organizationPath,
  useCurrentOrganization,
  useCurrentOrganizationSlug,
} from "../../../../lib/organizations"
import type { BuildWithApp } from "../../../../lib/apps"
import type { BuildStatus } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/dashboard")({
  component: DashboardPage,
})

function DashboardPage(): React.JSX.Element {
  const [modalOpen, setModalOpen] = React.useState(false)
  const organization = useCurrentOrganization()
  const {
    data: apps = [],
    isLoading: appsLoading,
    error: appsError,
  } = useApps(organization?.id)
  const { builds: recentBuilds, isLoading: buildsLoading } =
    useRecentBuildsAcrossApps(apps, 6)
  const { data: appConfig, isLoading: appConfigLoading } = useGitHubAppConfig()
  const { data: monitoring, isLoading: monitoringLoading } = useMonitoring()
  const containers = monitoring?.containers ?? []
  const appsWithRuntimeStatus = React.useMemo(
    () =>
      apps.map((app) => ({
        ...app,
        runtimeStatus: resolveRuntimeAppStatus(
          app.status,
          selectAppSnapshot(containers, app.id, app.containerId)
        ),
      })),
    [apps, containers]
  )

  const runningApps = appsWithRuntimeStatus.filter(
    (app) => app.runtimeStatus === "running"
  ).length
  const failedApps = appsWithRuntimeStatus.filter(
    (app) => app.runtimeStatus === "failed"
  ).length
  const latestBuild = recentBuilds.at(0)
  const runningContainers = containers.filter(
    (c) => c.status === "running"
  ).length
  const showOnboarding = apps.length === 0 || !appConfig?.configured

  return (
    <ShellPage
      title="Dashboard"
      description={
        appsLoading
          ? "Loading your workspace…"
          : `${apps.length} application${apps.length === 1 ? "" : "s"} · ${runningApps} running${failedApps > 0 ? ` · ${failedApps} failed` : ""}`
      }
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/settings/git-providers/$slug"
              params={{ slug: "github" }}
            >
              <RiGithubFill className="size-4" />
              GitHub setup
            </Link>
          </Button>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <RiAddLine className="size-4" />
            New application
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<RiAppsLine className="size-4" />}
          label="Applications"
          value={String(apps.length)}
          hint={`${runningApps} running`}
          loading={appsLoading}
        />
        <StatCard
          icon={<RiPlayCircleLine className="size-4" />}
          label="Runtime"
          value={String(runningContainers)}
          hint={
            monitoring
              ? `${containers.length} container${containers.length === 1 ? "" : "s"} tracked`
              : "Agent offline"
          }
          loading={monitoringLoading}
          tone={monitoring?.error ? "warning" : "default"}
        />
        <StatCard
          icon={<RiTimeLine className="size-4" />}
          label="Last deploy"
          value={latestBuild ? relativeTime(latestBuild.createdAt) : "Never"}
          hint={
            latestBuild
              ? `${latestBuild.appName} · ${latestBuild.status}`
              : "No deployments yet"
          }
          loading={buildsLoading}
          tone={latestBuild?.status === "failed" ? "danger" : "default"}
        />
        <StatCard
          icon={<RiGithubFill className="size-4" />}
          label="GitHub App"
          value={appConfig?.configured ? "Connected" : "Not configured"}
          hint={
            appConfig?.configured
              ? (appConfig.name ?? "Installed")
              : "Install to deploy from repos"
          }
          loading={appConfigLoading}
          tone={appConfig?.configured ? "success" : "warning"}
        />
      </div>

      {appsError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Failed to load applications: {appsError.message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <ShellPanel
          title="Recent activity"
          description="Latest build and deploy events across the workspace."
          action={
            apps.length > 0 ? (
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to={
                    (organization
                      ? organizationPath(organization.slug, "apps")
                      : "/apps") as never
                  }
                >
                  View all applications
                  <RiArrowRightLine className="size-3.5" />
                </Link>
              </Button>
            ) : null
          }
        >
          {buildsLoading ? (
            <ActivitySkeleton />
          ) : recentBuilds.length > 0 ? (
            <ul className="space-y-1">
              {recentBuilds.slice(0, 6).map((build) => (
                <ActivityRow key={build.id} build={build} />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No deployments yet.
            </p>
          )}
        </ShellPanel>

        {showOnboarding ? (
          <GettingStartedPanel
            githubConnected={appConfig?.configured ?? false}
            onCreateApp={() => setModalOpen(true)}
          />
        ) : (
          <ShellPanel
            title="Quick links"
            description="Jump to the rest of your workspace."
          >
            <div className="space-y-2">
              <QuickLink
                label="All applications"
                hint={`${apps.length} app${apps.length === 1 ? "" : "s"}`}
                to={
                  (organization
                    ? organizationPath(organization.slug, "apps")
                    : "/apps") as never
                }
              />
              <QuickLink
                label="Deployments"
                hint="Build and deploy history"
                to={
                  (organization
                    ? organizationPath(organization.slug, "deployments")
                    : "/deployments") as never
                }
              />
              <QuickLink
                label="Monitoring"
                hint="Containers and runtime"
                to={
                  (organization
                    ? organizationPath(organization.slug, "monitoring")
                    : "/monitoring") as never
                }
              />
            </div>
          </ShellPanel>
        )}
      </div>

      <CreateAppModal
        open={modalOpen}
        organizationId={organization?.id}
        onClose={() => setModalOpen(false)}
      />
    </ShellPage>
  )
}

type StatTone = "default" | "success" | "warning" | "danger"

function StatCard({
  icon,
  label,
  value,
  hint,
  loading = false,
  tone = "default",
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  loading?: boolean
  tone?: StatTone
}): React.JSX.Element {
  const accent =
    tone === "success"
      ? "text-green-600 dark:text-green-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground"

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className={`flex items-center gap-1.5 ${accent}`}>
        {icon}
        <span className="text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
      </div>
      {loading ? (
        <div className="mt-2 animate-pulse space-y-2" aria-hidden="true">
          <div className="h-7 w-16 rounded bg-muted" />
          <div className="h-3 w-28 rounded bg-muted" />
        </div>
      ) : (
        <>
          <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {hint}
          </p>
        </>
      )}
    </div>
  )
}

function QuickLink({
  label,
  hint,
  to,
}: {
  label: string
  hint: string
  to: string
}): React.JSX.Element {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
    >
      <span>
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <RiArrowRightLine className="size-4 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground" />
    </Link>
  )
}

function ActivityRow({ build }: { build: BuildWithApp }): React.JSX.Element {
  const tone = buildTone(build.status)
  const sha = build.commitSha ? build.commitSha.slice(0, 7) : "manual"
  const orgSlug = useCurrentOrganizationSlug()

  return (
    <li>
      <Link
        to={
          (orgSlug
            ? organizationPath(orgSlug, `apps/${build.appId}/settings`)
            : `/apps/${build.appId}/settings`) as never
        }
        className="group -mx-2 flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
      >
        <span className={`mt-1.5 inline-flex ${tone.color}`}>{tone.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {build.appName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{sha}</span>
            <span className="mx-1 opacity-60">·</span>
            <span className="capitalize">{build.status}</span>
            <span className="mx-1 opacity-60">·</span>
            {relativeTime(build.createdAt)}
          </p>
        </div>
      </Link>
    </li>
  )
}

function ActivitySkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-start gap-2.5">
          <div className="mt-1 size-3 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-2.5 w-40 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

function buildTone(status: BuildStatus): {
  icon: React.JSX.Element
  color: string
} {
  switch (status) {
    case "succeeded":
      return {
        icon: <RiCheckboxCircleFill className="size-3.5" />,
        color: "text-green-600 dark:text-green-400",
      }
    case "failed":
    case "cancelled":
      return {
        icon: <RiErrorWarningFill className="size-3.5" />,
        color: "text-destructive",
      }
    case "running":
      return {
        icon: <RiPulseFill className="size-3.5 animate-pulse" />,
        color: "text-blue-600 dark:text-blue-400",
      }
    case "pending":
    default:
      return {
        icon: <RiTimeLine className="size-3.5" />,
        color: "text-muted-foreground",
      }
  }
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms
  if (delta < 60_000) return "just now"
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })
}
