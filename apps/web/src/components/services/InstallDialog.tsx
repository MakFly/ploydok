// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { RiServerLine } from "@remixicon/react"

interface InstallDialogProps {
  open: boolean
  templateName: string
  templateVersion: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function InstallDialog({
  open,
  templateName,
  templateVersion,
  isPending,
  onConfirm,
  onCancel,
}: InstallDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiServerLine className="size-5 text-muted-foreground" />
            Installer {templateName}
          </DialogTitle>
          <DialogDescription>
            Cette action va spawner des containers Docker sur ton host pour{" "}
            <strong>{templateName}</strong> v{templateVersion}. Les variables
            d'environnement nécessaires seront générées automatiquement.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          Des containers seront démarrés sur ton host. Assure-toi d'avoir les
          ressources suffisantes avant de continuer.
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Annuler
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Installation…" : "Installer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
