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
import { apiBaseUrl } from "../../lib/api/base"
import {
  
  
  useCreateAdminerSession,
  useRevealDatabaseCredentials
} from "../../lib/databases"
import type {AdminerSessionLaunch, Database} from "../../lib/databases";

const AUTO_HIDE_PASSWORD_MS = 30_000

interface OpenAdminerDialogProps {
  database: Database | null
  onClose: () => void
}

function adminerUrl(path: string): string {
  const base = apiBaseUrl().replace(/\/+$/, "")
  return `${base}${path}`
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extractPassword(connectionString: string): string {
  const schemeEnd = connectionString.indexOf("://")
  if (schemeEnd === -1) {
    throw new Error("Connection string scheme is missing")
  }

  const rest = connectionString.slice(schemeEnd + 3)
  const authorityEndCandidates = ["/", "?", "#"]
    .map((separator) => rest.indexOf(separator))
    .filter((index) => index !== -1)
  const authorityEnd =
    authorityEndCandidates.length > 0
      ? Math.min(...authorityEndCandidates)
      : rest.length
  const authority = rest.slice(0, authorityEnd)
  const atIndex = authority.lastIndexOf("@")
  if (atIndex === -1) {
    throw new Error("Connection string credentials are missing")
  }

  const userInfo = authority.slice(0, atIndex)
  const passwordSeparator = userInfo.indexOf(":")
  if (passwordSeparator === -1) {
    throw new Error("Connection string password is missing")
  }

  const password = safeDecode(userInfo.slice(passwordSeparator + 1))
  if (!password) throw new Error("Connection string password is missing")
  return password
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the legacy path below for plain HTTP/IP origins.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    const copied = document.execCommand("copy")
    if (!copied) throw new Error("Copy command failed")
  } finally {
    textarea.remove()
  }
}

export function OpenAdminerDialog({
  database,
  onClose,
}: OpenAdminerDialogProps): React.JSX.Element {
  const [totpCode, setTotpCode] = React.useState("")
  const [launch, setLaunch] = React.useState<AdminerSessionLaunch | null>(null)
  const [revealedPassword, setRevealedPassword] = React.useState<string | null>(
    null
  )
  const [passwordCountdown, setPasswordCountdown] = React.useState(0)
  const createSession = useCreateAdminerSession()
  const reveal = useRevealDatabaseCredentials()

  const open = Boolean(database)
  const launchUrl = launch ? adminerUrl(launch.path) : null

  React.useEffect(() => {
    if (!revealedPassword) {
      setPasswordCountdown(0)
      return
    }

    setPasswordCountdown(AUTO_HIDE_PASSWORD_MS / 1000)
    const timer = window.setInterval(() => {
      setPasswordCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          setRevealedPassword(null)
          return 0
        }

        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [revealedPassword])

  function handleClose() {
    setTotpCode("")
    setLaunch(null)
    setRevealedPassword(null)
    onClose()
  }

  function handleCreateSession() {
    if (!database) return
    createSession.mutate(
      { id: database.id, totpCode },
      {
        onSuccess: (nextLaunch) => {
          setLaunch(nextLaunch)
          setTotpCode("")
          setRevealedPassword(null)
        },
      }
    )
  }

  function handleRevealPassword() {
    if (!database) return
    reveal.mutate(
      { id: database.id },
      {
        onSuccess: (credentials) => {
          try {
            const password =
              typeof credentials.password === "string" &&
              credentials.password.length > 0
                ? credentials.password
                : extractPassword(credentials.connection_string)
            setRevealedPassword(password)
            toast.success("Database password revealed")
          } catch {
            toast.error("Unable to extract password from connection string")
          }
        },
        onError: (err: Error) => {
          toast.error(err.message || "Reveal failed")
        },
      }
    )
  }

  function handleCopyPassword() {
    if (!revealedPassword) return
    void copyTextToClipboard(revealedPassword)
      .then(() => toast.success("Database password copied"))
      .catch(() => {
        toast.error("Clipboard unavailable", {
          description: "Select the password field and copy it manually.",
        })
      })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open Adminer</DialogTitle>
          <DialogDescription>
            Adminer will be locked to this database. Reveal and copy the
            generated database password before opening Adminer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {launch ? (
            <div className="grid gap-4 rounded-lg border p-3 text-sm">
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
                <span className="text-muted-foreground">Server</span>
                <span className="truncate font-mono">{launch.server}</span>
                <span className="text-muted-foreground">Database</span>
                <span className="truncate font-mono">{launch.database}</span>
                <span className="text-muted-foreground">Username</span>
                <span className="truncate font-mono">{launch.username}</span>
                <span className="text-muted-foreground">Expires</span>
                <span>{new Date(launch.expires_at).toLocaleTimeString()}</span>
              </div>

              {revealedPassword ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="adminer-password">Password</Label>
                    <span className="text-xs text-muted-foreground">
                      Auto-hide in {passwordCountdown}s
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="adminer-password"
                      readOnly
                      value={revealedPassword}
                      className="font-mono text-xs"
                      type="text"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleCopyPassword}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="adminer-totp">TOTP code</Label>
              <Input
                id="adminer-totp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(event) =>
                  setTotpCode(
                    event.target.value.replace(/\D+/g, "").slice(0, 6)
                  )
                }
                autoComplete="one-time-code"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={createSession.isPending || reveal.isPending}
          >
            Close
          </Button>
          {launch && launchUrl ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleRevealPassword}
                disabled={reveal.isPending}
              >
                {reveal.isPending
                  ? "Revealing..."
                  : revealedPassword
                    ? "Reveal again"
                    : "Reveal password"}
              </Button>
              {revealedPassword ? (
                <Button asChild>
                  <a href={launchUrl} target="_blank" rel="noreferrer">
                    Open Adminer
                  </a>
                </Button>
              ) : (
                <Button type="button" disabled>
                  Open Adminer
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              onClick={handleCreateSession}
              disabled={createSession.isPending || totpCode.length !== 6}
            >
              {createSession.isPending ? "Opening..." : "Create session"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
