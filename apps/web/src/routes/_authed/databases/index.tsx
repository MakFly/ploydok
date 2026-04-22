// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ShellPage } from "../../../components/layout/AppShell"
import { useDatabases } from "../../../lib/databases"
import { DatabaseCard } from "../../../components/databases/DatabaseCard"
import { CreateDatabaseDialog } from "../../../components/databases/CreateDatabaseDialog"
import { RevealConnectionDialog } from "../../../components/databases/RevealConnectionDialog"
import type { Database } from "../../../lib/databases"

export const Route = createFileRoute("/_authed/databases/")({
  component: DatabasesPage,
})

function DatabasesPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = React.useState(false)
  const [revealDbId, setRevealDbId] = React.useState<string | null>(null)

  // No project filter at top-level — show all
  const { data: databases, isLoading, error } = useDatabases()

  // Project ID for create dialog — use first DB's project if available
  const projectId = databases?.[0]?.project_id ?? ""

  return (
    <ShellPage title="Databases">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Databases</h1>
        <Button onClick={() => setCreateOpen(true)} disabled={!projectId}>
          + New database
        </Button>
      </div>

      {isLoading && (
        <div className="text-muted-foreground text-sm">Loading databases...</div>
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

      {projectId && (
        <CreateDatabaseDialog
          open={createOpen}
          projectId={projectId}
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
