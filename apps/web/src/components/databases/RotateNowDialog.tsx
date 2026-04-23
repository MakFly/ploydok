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
import { useRotateDatabase } from "../../lib/databases"

interface RotateNowDialogProps {
  databaseId: string | null
  onClose: () => void
}

export function RotateNowDialog({ databaseId, onClose }: RotateNowDialogProps): React.JSX.Element {
  const [confirmed, setConfirmed] = React.useState(false)
  const [totpCode, setTotpCode] = React.useState("")
  const { mutate: rotate, isPending } = useRotateDatabase()

  function handleClose() {
    setConfirmed(false)
    setTotpCode("")
    onClose()
  }

  function handleRotate() {
    if (!databaseId) return
    rotate({ id: databaseId, totpCode }, {
      onSuccess: () => {
        handleClose()
      },
    })
  }

  return (
    <Dialog open={Boolean(databaseId)} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rotate database password</DialogTitle>
          <DialogDescription>
            This will generate a new password, update all linked apps, and
            trigger a rolling redeploy. The old password remains active until
            all apps are healthy (max 5 min double-write window).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            All apps linked to this database will be redeployed automatically.
            If rotation fails, the old password will be restored.
          </div>

          {!confirmed ? (
            <Button
              variant="outline"
              onClick={() => setConfirmed(true)}
            >
              I understand, continue
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="rotate-database-totp">TOTP code</Label>
              <Input
                id="rotate-database-totp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D+/g, "").slice(0, 6))}
                autoComplete="one-time-code"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          {confirmed && (
            <Button
              variant="destructive"
              onClick={handleRotate}
              disabled={isPending || totpCode.length !== 6}
            >
              {isPending ? "Rotating…" : "Rotate password"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
