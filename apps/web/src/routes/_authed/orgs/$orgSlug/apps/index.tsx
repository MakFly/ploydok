// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { RiAddLine, RiArrowRightUpLine, RiGitBranchLine, RiGlobalLine } from "@remixicon/react"
import { CreateAppModal } from "../../../../../components/apps/CreateAppModal"
import { ShellPage, ShellPanel } from "../../../../../components/layout/AppShell"
import { AppStatusBadge } from "../../../../../components/apps/AppStatusBadge"
import { resolveRuntimeAppStatus, selectAppSnapshot } from "../../../../../lib/app-runtime"
import { useApps } from "../../../../../lib/apps"
import { useGitHubAppConfig } from "../../../../../lib/github"
import { useMonitoring } from "../../../../../lib/monitoring"
import { organizationPath, useCurrentOrganization, useCurrentOrganizationSlug } from "../../../../../lib/organizations"
import type { AppListItem } from "../../../../../lib/apps"

function AppsPage(): React.JSX.Element {
  const [modalOpen, setModalOpen] = React.useState(false)
  const organization = useCurrentOrganization()
  const currentOrgSlug = useCurrentOrganizationSlug()
  const { data: apps = [], isLoading, error } = useApps(organization?.id)
  const { data: appConfig } = useGitHubAppConfig()
  const { data: monitoring } = useMonitoring()
  const containers = monitoring?.containers ?? []
  const appsWithRuntimeStatus = React.useMemo(
    () =>
      apps.map((app) => ({
        ...app,
        runtimeStatus: resolveRuntimeAppStatus(app.status, selectAppSnapshot(containers, app.id)),
      })),
    [apps, containers],
  )

  return (
    <ShellPage
      title="Applications"
      description="Tes applications déployées — build, run et monitoring depuis un seul endroit."
      eyebrow="Workspace"
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/git-providers/$slug" params={{ slug: "github" }}>GitHub setup</Link>
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
          title="Applications"
          description="Toutes tes apps déployées et leur état actuel."
        >
          {isLoading ? (
            <AppsGridSkeleton />
          ) : error ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              Failed to load apps: {error.message}
            </p>
          ) : appsWithRuntimeStatus.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {appsWithRuntimeStatus.map((app) => (
                <AppCard key={app.id} app={app} currentOrgSlug={currentOrgSlug} />
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
          <ShellPanel title="Démarrer" description="Les premières étapes utiles.">
            <div className="space-y-3">
              <MiniStep
                label="Connect GitHub"
                body={
                  appConfig?.configured
                    ? "GitHub App is already configured."
                    : "Install the GitHub App to unlock repository selection."
                }
                to="/settings/git-providers/$slug"
                params={{ slug: "github" }}
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

          <ShellPanel title="Snapshot" description="Résumé léger de ton workspace.">
            <div className="grid gap-3">
              <SnapshotRow label="Total apps" value={String(apps.length)} />
              <SnapshotRow
                label="Running"
                value={String(appsWithRuntimeStatus.filter((app) => app.runtimeStatus === "running").length)}
              />
              <SnapshotRow
                label="GitHub"
                value={appConfig?.configured ? "Connected" : "Pending"}
              />
            </div>
          </ShellPanel>
        </div>
      </div>

      <CreateAppModal
        open={modalOpen}
        organizationId={organization?.id}
        onClose={() => setModalOpen(false)}
      />
    </ShellPage>
  )
}

function AppCard({
  app,
  currentOrgSlug,
}: {
  app: AppListItem & { runtimeStatus: AppListItem["status"] }
  currentOrgSlug: string | null
}): React.JSX.Element {
  return (
    <Link
      to={(currentOrgSlug ? organizationPath(currentOrgSlug, `apps/${app.id}/overview`) : `/apps/${app.id}/overview`) as never}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {app.name}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {app.repoFullName ?? "Repository pending"}
          </p>
        </div>
        <AppStatusBadge status={app.runtimeStatus} />
      </div>

      <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <RiGitBranchLine className="size-4" />
          <span>{app.branch ?? "main"}</span>
        </div>
        <div className="flex items-center gap-2">
          <RiGlobalLine className="size-4" />
          <span className="truncate">{app.domain ?? "Domain pending"}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Open deployment</span>
        <RiArrowRightUpLine className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  )
}

function EmptyState({
  isGitHubConnected,
  onCreateApp,
}: {
  isGitHubConnected: boolean
  onCreateApp: () => void
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">No applications yet</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {isGitHubConnected
          ? "Start the first deployment and this grid will fill up."
          : "Connect GitHub first so Ploydok can read repositories and create deployments."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {isGitHubConnected ? (
          <Button size="sm" onClick={onCreateApp}>
            Create app
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/git-providers/$slug" params={{ slug: "github" }}>Connect GitHub</Link>
          </Button>
        )}
      </div>
    </div>
  )
}

function AppsGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-lg border border-border bg-card p-4"
        >
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="mt-2 h-3 w-44 rounded bg-muted" />
          <div className="mt-6 h-3 w-20 rounded bg-muted" />
          <div className="mt-2 h-3 w-28 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function MiniStep({
  label,
  body,
  to,
  params,
}: {
  label: string
  body: string
  to: string
  params?: Record<string, string>
}): React.JSX.Element {
  const linkProps = { to, ...(params ? { params } : {}) } as Parameters<typeof Link>[0]
  return (
    <Link
      {...linkProps}
      className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
    >
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-muted-foreground" />
    </Link>
  )
}

function MiniButton({
  label,
  body,
  onClick,
}: {
  label: string
  body: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/40"
    >
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-muted-foreground" />
    </button>
  )
}

function SnapshotRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/")({
  component: AppsPage,
})
