// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { RiDeleteBinLine } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
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
import { useDeleteApp } from "../../lib/apps-mutations"
import { useMe } from "../../lib/auth"
import { useCurrentOrganizationSlug } from "../../lib/organizations"
import type { AppDetail } from "../../lib/apps"

interface DeleteAppButtonProps {
  app: AppDetail
}

export function DeleteAppButton({
  app,
}: DeleteAppButtonProps): React.JSX.Element {
  const router = useRouter()
  const orgSlug = useCurrentOrganizationSlug()
  const [open, setOpen] = React.useState(false)
  const [confirmName, setConfirmName] = React.useState("")
  const [actionError, setActionError] = React.useState<string | null>(null)

  const deleteApp = useDeleteApp(app.id)
  const { data: me } = useMe()
  const needs2FA = Boolean(me?.needs_second_factor)
  const lockTitle = needs2FA
    ? "Configurez un second facteur pour débloquer cette action."
    : "Delete app"

  const close = (): void => {
    setOpen(false)
    setConfirmName("")
    setActionError(null)
  }

  const handleDelete = async (): Promise<void> => {
    if (confirmName !== app.name) return
    try {
      await deleteApp.mutateAsync()
      const href = orgSlug ? `/orgs/${orgSlug}/apps` : "/apps"
      void router.navigate({ href })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed")
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={needs2FA}
        title={lockTitle}
        onClick={() => setOpen(true)}
        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <RiDeleteBinLine className="size-3.5" aria-hidden="true" />
        Delete app
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the containers, registry images, build
              artifacts, Caddy route, and database row. Type{" "}
              <span className="font-mono font-semibold text-foreground">
                {app.name}
              </span>{" "}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={app.name}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:ring-1 focus:ring-destructive"
            autoFocus
          />

          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={close} disabled={deleteApp.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleteApp.isPending || confirmName !== app.name}
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
            >
              {deleteApp.isPending ? "Deleting…" : "Delete app"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
