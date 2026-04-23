// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { toast } from "sonner"
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
  const [totpCode, setTotpCode] = React.useState("")
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
    setTotpCode("")
    onClose()
  }

  function handleReveal() {
    if (!databaseId || totpCode.length < 6) return
    reveal({ id: databaseId, totpCode }, {
      onSuccess: (value) => {
        setConnString(value)
      },
    })
  }

  function handleCopy() {
    if (!connString) return
    navigator.clipboard.writeText(connString).then(() => toast.success("Copied!"))
  }

  return (
    <Dialog open={Boolean(databaseId)} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reveal connection string</DialogTitle>
          <DialogDescription>
            Enter your TOTP code to reveal the connection string. It will be hidden after 30 seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!connString ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp-code">TOTP code</Label>
              <Input
                id="totp-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleReveal()}
              />
            </div>
          ) : (
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
              <span className="text-xs text-muted-foreground">
                Hidden in {countdown}s
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
          {!connString && (
            <Button
              onClick={handleReveal}
              disabled={isPending || totpCode.length < 6}
            >
              {isPending ? "Verifying..." : "Reveal"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
