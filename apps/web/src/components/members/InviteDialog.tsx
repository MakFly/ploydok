// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useInviteMember } from "../../lib/memberships"

interface InviteDialogProps {
  open: boolean
  orgSlug: string
  onClose: () => void
}

export function InviteDialog({
  open,
  orgSlug,
  onClose,
}: InviteDialogProps): React.JSX.Element {
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<"member">("member")
  const [error, setError] = React.useState<string | null>(null)
  const inviteMutation = useInviteMember()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address")
      return
    }

    inviteMutation.mutate(
      { orgSlug, email, role },
      {
        onSuccess: () => {
          setEmail("")
          setRole("member")
          onClose()
        },
        onError: (err) => {
          const message =
            err instanceof Error ? err.message : "Failed to send invitation"
          setError(message)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(newOpen) => !newOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Send an invitation to join this workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="text-xs font-medium text-muted-foreground"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="role"
              className="text-xs font-medium text-muted-foreground"
            >
              Role
            </label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as "member")}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="owner" disabled>
                  Owner (v2+)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={inviteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviteMutation.isPending}
              className="flex-1"
            >
              {inviteMutation.isPending ? "Sending..." : "Send invitation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
