// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { useBuilds } from "../../lib/apps"
import {
  useDeleteApp,
  useRestartApp,
  useRollbackApp,
  useStopApp,
} from "../../lib/apps-mutations"
import { useMe } from "../../lib/auth"
import type { AppDetail } from "../../lib/apps"
import type { Build } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DialogKind = "stop" | "restart" | "rollback" | "delete" | null

// ---------------------------------------------------------------------------
// ActionsMenu
// ---------------------------------------------------------------------------

interface ActionsMenuProps {
  app: AppDetail
}

export function ActionsMenu({ app }: ActionsMenuProps): React.JSX.Element {
  const router = useRouter()
  const [openDialog, setOpenDialog] = React.useState<DialogKind>(null)
  const [deleteConfirmName, setDeleteConfirmName] = React.useState("")
  const [selectedBuildId, setSelectedBuildId] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const stop = useStopApp(app.id)
  const restart = useRestartApp(app.id)
  const rollback = useRollbackApp(app.id)
  const deleteApp = useDeleteApp(app.id)
  const { data: builds } = useBuilds(app.id)
  const { data: me } = useMe()
  const needs2FA = Boolean(me?.needs_second_factor)
  const lockTitle = needs2FA
    ? "Configurez un second facteur pour débloquer cette action."
    : undefined

  const succeededBuilds = React.useMemo(
    () => (builds ?? []).filter((b: Build) => b.status === "succeeded").slice(0, 10),
    [builds],
  )

  const isBusy = stop.isPending || restart.isPending || rollback.isPending || deleteApp.isPending

  const openDialogFor = (kind: DialogKind): void => {
    setActionError(null)
    setDeleteConfirmName("")
    setSelectedBuildId(succeededBuilds[0]?.id ?? null)
    setOpenDialog(kind)
  }

  const closeDialog = (): void => {
    setOpenDialog(null)
    setDeleteConfirmName("")
    setSelectedBuildId(null)
    setActionError(null)
  }

  const handleStop = async (): Promise<void> => {
    try {
      await stop.mutateAsync()
      closeDialog()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Stop failed")
    }
  }

  const handleRestart = async (): Promise<void> => {
    try {
      await restart.mutateAsync()
      closeDialog()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Restart failed")
    }
  }

  const handleRollback = async (): Promise<void> => {
    if (!selectedBuildId) return
    try {
      await rollback.mutateAsync({ buildId: selectedBuildId })
      closeDialog()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rollback failed")
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (deleteConfirmName !== app.name) return
    try {
      // No flags = server uses all-true defaults = full cascade wipe.
      await deleteApp.mutateAsync()
      void router.navigate({ to: "/apps" })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed")
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            aria-label="App actions"
            title="App actions"
            className="size-7 p-0"
          >
            <MoreIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => openDialogFor("restart")}
            disabled={needs2FA}
            title={lockTitle}
          >
            Restart
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openDialogFor("stop")}
            disabled={needs2FA}
            title={lockTitle}
          >
            Stop
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openDialogFor("rollback")}
            disabled={needs2FA}
            title={lockTitle}
          >
            Rollback
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => openDialogFor("delete")}
            disabled={needs2FA}
            title={lockTitle}
          >
            Delete app
          </DropdownMenuItem>
          {needs2FA ? (
            <p className="px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground leading-tight">
              Second facteur requis — configurez-le depuis Settings → Security.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Stop dialog */}
      <AlertDialog open={openDialog === "stop"} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app container will be stopped. You can restart it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDialog} disabled={isBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleStop()}
              disabled={isBusy}
            >
              {stop.isPending ? "Stopping…" : "Stop"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restart dialog */}
      <AlertDialog open={openDialog === "restart"} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app container will be restarted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDialog} disabled={isBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRestart()}
              disabled={isBusy}
            >
              {restart.isPending ? "Restarting…" : "Restart"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback dialog */}
      <AlertDialog open={openDialog === "rollback"} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback {app.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Select a successful build to roll back to.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {succeededBuilds.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">
              No successful build to rollback to.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
              {succeededBuilds.map((build) => (
                <label
                  key={build.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <input
                    type="radio"
                    name="rollback-build"
                    value={build.id}
                    checked={selectedBuildId === build.id}
                    onChange={() => setSelectedBuildId(build.id)}
                    className="accent-primary"
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {build.commitSha ? build.commitSha.slice(0, 7) : build.id.slice(0, 7)}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    {build.finishedAt
                      ? new Date(build.finishedAt).toLocaleDateString()
                      : "—"}
                  </span>
                </label>
              ))}
            </div>
          )}

          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDialog} disabled={isBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRollback()}
              disabled={isBusy || !selectedBuildId || succeededBuilds.length === 0}
            >
              {rollback.isPending ? "Rolling back…" : "Rollback"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog — full cascade wipe, typing confirm. */}
      <AlertDialog open={openDialog === "delete"} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the containers, registry images,
              build artifacts, Caddy route, and database row. Type{" "}
              <span className="font-mono font-semibold text-foreground">{app.name}</span>{" "}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <input
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={app.name}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-destructive"
            autoFocus
          />

          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDialog} disabled={isBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={isBusy || deleteConfirmName !== app.name}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteApp.isPending ? "Deleting…" : "Delete app"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}


// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function MoreIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
    </svg>
  )
}
