// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { RiAddLine, RiArrowRightUpLine } from "@remixicon/react"
import { ShellPage, ShellPanel } from "../../../../../components/layout/AppShell"
import { CreateDatabaseDialog } from "../../../../../components/databases/CreateDatabaseDialog"
import { DatabaseCard } from "../../../../../components/databases/DatabaseCard"
import { useDatabases } from "../../../../../lib/databases"
import { useCurrentOrganization } from "../../../../../lib/organizations"
import type { Database } from "../../../../../lib/databases"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/databases/")({
  component: DatabasesPage,
})

function DatabasesPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = React.useState(false)
  const organization = useCurrentOrganization()
  const organizationId = organization?.id ?? ""

  const { data: databases = [], isLoading, error } = useDatabases(organization?.id)

  const runningCount = databases.filter((db) => db.status === "running").length
  const linkedCount = databases.filter((db) => (db.linked_apps?.length ?? 0) > 0).length

  return (
    <ShellPage
      title="Databases"
      description="Tes bases de données managées — provisioning, connexions et rotation au même endroit."
      eyebrow="Workspace"
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!organizationId}>
          <RiAddLine className="size-4" />
          New database
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.9fr_1fr]">
        <ShellPanel
          title="Databases"
          description="Toutes tes bases de données provisionnées et leur état actuel."
        >
          {isLoading ? (
            <DatabasesGridSkeleton />
          ) : error ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              Failed to load databases.
            </p>
          ) : databases.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {databases.map((db: Database) => (
                <DatabaseCard key={db.id} database={db} />
              ))}
            </div>
          ) : (
            <EmptyState onCreate={() => setCreateOpen(true)} disabled={!organizationId} />
          )}
        </ShellPanel>

        <div className="grid gap-4">
          <ShellPanel title="Démarrer" description="Les premières étapes utiles.">
            <div className="space-y-3">
              <MiniButton
                label="Create a new database"
                body="Choisis un moteur (Postgres, MySQL, Redis…) et un plan."
                onClick={() => setCreateOpen(true)}
                disabled={!organizationId}
              />
              <MiniStep
                label="Link an app"
                body="Branche une application existante à une base via les variables d'environnement."
                to="/orgs/$orgSlug/apps"
                params={{ orgSlug: organization?.slug ?? "" }}
              />
              <MiniStep
                label="Review the guide"
                body="Notes opérationnelles sur les bases managées."
                to="/guide"
              />
            </div>
          </ShellPanel>

          <ShellPanel title="Snapshot" description="Résumé léger de ton workspace.">
            <div className="grid gap-3">
              <SnapshotRow label="Total databases" value={String(databases.length)} />
              <SnapshotRow label="Running" value={String(runningCount)} />
              <SnapshotRow label="Linked to an app" value={String(linkedCount)} />
            </div>
          </ShellPanel>
        </div>
      </div>

      {organizationId && (
        <CreateDatabaseDialog
          open={createOpen}
          organizationId={organizationId}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </ShellPage>
  )
}

function EmptyState({
  onCreate,
  disabled,
}: {
  onCreate: () => void
  disabled: boolean
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">No databases yet</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Provisionne ta première base et elle apparaîtra ici.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button size="sm" onClick={onCreate} disabled={disabled}>
          Create database
        </Button>
      </div>
    </div>
  )
}

function DatabasesGridSkeleton(): React.JSX.Element {
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
  disabled,
}: {
  label: string
  body: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
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
