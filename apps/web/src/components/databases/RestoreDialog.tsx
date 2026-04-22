// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { useRestoreBackup, type Backup } from "../../lib/backups"

interface RestoreDialogProps {
  backup: Backup
  databaseId: string
  databaseName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RestoreDialog({
  backup,
  databaseId,
  databaseName,
  open,
  onOpenChange,
}: RestoreDialogProps): React.JSX.Element {
  const restore = useRestoreBackup(databaseId)
  const [ageIdentity, setAgeIdentity] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const expectedConfirm = `restore ${databaseName}`

  function handleClose() {
    // Clear sensitive data on close
    setAgeIdentity("")
    setConfirm("")
    onOpenChange(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await restore.mutateAsync({
      backupId: backup.id,
      ageIdentity: ageIdentity || undefined,
      confirm,
    })
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore database</DialogTitle>
          <DialogDescription>
            Restoring from backup{" "}
            <span className="font-mono text-xs">{backup.id}</span> will overwrite the current database
            contents. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              This will destroy all current data in <strong>{databaseName}</strong> and replace it
              with the backup contents.
            </AlertDescription>
          </Alert>

          {backup.ageEncrypted && (
            <div className="space-y-1.5">
              <Label htmlFor="age-identity">age private key</Label>
              <Textarea
                id="age-identity"
                placeholder="AGE-SECRET-KEY-..."
                value={ageIdentity}
                onChange={(e) => setAgeIdentity(e.target.value)}
                rows={3}
                className="font-mono text-xs"
                required={backup.ageEncrypted}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                The backup is age-encrypted. Paste your private key here — it will not be stored.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="restore-confirm">
              Type{" "}
              <code className="font-mono bg-muted px-1 rounded text-xs">{expectedConfirm}</code> to
              confirm
            </Label>
            <Input
              id="restore-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={expectedConfirm}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={
                restore.isPending ||
                confirm !== expectedConfirm ||
                (backup.ageEncrypted && !ageIdentity)
              }
            >
              {restore.isPending ? "Restoring…" : "Restore now"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
