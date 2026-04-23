// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ShellPage } from "../../../components/layout/AppShell"
import { useDatabases } from "../../../lib/databases"
import { useCurrentOrganization } from "../../../lib/organizations"
import { redirectToDefaultOrganization } from "../../../lib/auth-guards"
import { DatabaseCard } from "../../../components/databases/DatabaseCard"
import { CreateDatabaseDialog } from "../../../components/databases/CreateDatabaseDialog"
import { RevealConnectionDialog } from "../../../components/databases/RevealConnectionDialog"
import type { Database } from "../../../lib/databases"

export const Route = createFileRoute("/_authed/databases/")({
  beforeLoad: async () => redirectToDefaultOrganization(),
  component: DatabasesPage,
})

export function DatabasesPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = React.useState(false)
  const [revealDbId, setRevealDbId] = React.useState<string | null>(null)
  const organization = useCurrentOrganization()

  const { data: databases, isLoading, error } = useDatabases(organization?.id)
  const organizationId = organization?.id ?? ""

  return (
    <ShellPage
      title="Databases"
      actions={
        <Button onClick={() => setCreateOpen(true)} disabled={!organizationId}>
          + New database
        </Button>
      }
    >

      {isLoading && (
        <DatabasesSkeleton />
      )}

      {error && (
        <div className="text-destructive text-sm">Failed to load databases.</div>
      )}

      {!isLoading && !error && databases?.length === 0 && (
        <div className="text-muted-foreground text-sm text-center py-12">
          No databases yet. Create one to get started.
        </div>
      )}

      {databases && databases.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {databases.map((db: Database) => (
            <DatabaseCard
              key={db.id}
              database={db}
              onReveal={() => setRevealDbId(db.id)}
            />
          ))}
        </div>
      )}

      {organizationId && (
        <CreateDatabaseDialog
          open={createOpen}
          organizationId={organizationId}
          onClose={() => setCreateOpen(false)}
        />
      )}

      <RevealConnectionDialog
        databaseId={revealDbId}
        onClose={() => setRevealDbId(null)}
      />
    </ShellPage>
  )
}

function DatabasesSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  )
}
