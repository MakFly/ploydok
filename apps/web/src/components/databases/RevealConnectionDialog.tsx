// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { toast } from "sonner"
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
import { useRevealDatabase } from "../../lib/databases"

const AUTO_HIDE_MS = 30_000

interface RevealConnectionDialogProps {
  databaseId: string | null
  onClose: () => void
}

export function RevealConnectionDialog({ databaseId, onClose }: RevealConnectionDialogProps): React.JSX.Element {
  const [connString, setConnString] = React.useState<string | null>(null)
  const [countdown, setCountdown] = React.useState(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const { mutate: reveal, isPending } = useRevealDatabase()

  React.useEffect(() => {
    if (connString !== null) {
      setCountdown(AUTO_HIDE_MS / 1000)
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(timerRef.current!)
            setConnString(null)
            return 0
          }
          return c - 1
        })
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [connString])

  function handleClose() {
    if (timerRef.current) clearInterval(timerRef.current)
    setConnString(null)
    onClose()
  }

  function handleConfirm() {
    if (!databaseId) return
    reveal(
      { id: databaseId },
      {
        onSuccess: (value) => {
          setConnString(value)
        },
        onError: (err: Error) => {
          toast.error(err.message || "Reveal failed")
        },
      },
    )
  }

  function handleCopy() {
    if (!connString) return
    navigator.clipboard.writeText(connString).then(() => toast.success("Copied!"))
  }

  const isOpen = Boolean(databaseId)

  // Step 1 — confirmation (no secret yet)
  if (!connString) {
    return (
      <AlertDialog open={isOpen} onOpenChange={(v) => !v && handleClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reveal connection string?</AlertDialogTitle>
            <AlertDialogDescription>
              The connection string contains sensitive credentials. It will stay visible for 30 seconds, then auto-hide. Make sure no one is looking over your shoulder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirm()
              }}
              disabled={isPending}
            >
              {isPending ? "Revealing…" : "Reveal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  // Step 2 — secret shown
  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connection string</DialogTitle>
          <DialogDescription>
            Auto-hide in {countdown}s.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label>Connection string</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={connString}
              className="font-mono text-xs"
              type="text"
            />
            <Button size="sm" variant="outline" onClick={handleCopy}>
              Copy
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
