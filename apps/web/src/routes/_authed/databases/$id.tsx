// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ShellPage } from "../../../components/layout/AppShell"
import { useDatabase, useDeleteDatabase } from "../../../lib/databases"
import { RevealConnectionDialog } from "../../../components/databases/RevealConnectionDialog"
import { RotationPanel } from "../../../components/databases/RotationPanel"

export const Route = createFileRoute("/_authed/databases/$id")({
  component: DatabaseDetailPage,
})

function DatabaseDetailPage(): React.JSX.Element {
  const { id } = Route.useParams()
  const { data: db, isLoading, error, refetch } = useDatabase(id)
  const [revealOpen, setRevealOpen] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const { mutate: deleteDb, isPending: isDeleting } = useDeleteDatabase()

  if (isLoading) {
    return <ShellPage title="Database"><div className="text-muted-foreground">Loading...</div></ShellPage>
  }

  if (error || !db) {
    return <ShellPage title="Database"><div className="text-destructive">Database not found.</div></ShellPage>
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    deleteDb({ id: db!.id, name: db!.name })
  }

  return (
    <ShellPage title={db.name}>
      <div className="flex flex-col gap-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">{db.name}</h1>
            <span className="text-muted-foreground text-sm">
              {db.kind} · {db.plan} plan
            </span>
          </div>
          <Badge variant={db.status === "running" ? "default" : "secondary"}>
            {db.status}
          </Badge>
        </div>

        <div className="border rounded-lg p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Host</span>
              <div className="font-mono">{db.host ?? "—"}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Port</span>
              <div className="font-mono">{db.port ?? "—"}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Rotation</span>
              <div>{db.rotation_schedule}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <div>{new Date(db.created_at).toLocaleDateString()}</div>
            </div>
          </div>
        </div>

        <RotationPanel
          db={db}
          onScheduleChange={() => void refetch()}
        />

        {db.linked_apps && db.linked_apps.length > 0 && (
          <div className="border rounded-lg p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-sm">Linked apps</h2>
            {db.linked_apps.map((link) => (
              <div key={link.app_id + link.env_prefix} className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{link.env_prefix}</Badge>
                <span className="text-muted-foreground font-mono text-xs">{link.app_id}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setRevealOpen(true)}>
            Reveal connection string
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {confirmDelete ? (isDeleting ? "Deleting..." : "Confirm delete") : "Delete"}
          </Button>
          {confirmDelete && (
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <RevealConnectionDialog
        databaseId={revealOpen ? id : null}
        onClose={() => setRevealOpen(false)}
      />
    </ShellPage>
  )
}
