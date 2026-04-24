// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiDeleteBin6Line } from "@remixicon/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useRemoveMember, useUpdateMemberRole } from "../../lib/memberships"
import { RemoveMemberDialog } from "./RemoveMemberDialog"
import type { MemberListItem } from "@ploydok/shared"

interface Member extends MemberListItem {
  is_me: boolean
}

function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date
  const now = new Date()
  const seconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000)

  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

interface MemberRowProps {
  member: Member
  orgSlug: string
  isOwner: boolean
}

export function MemberRow({
  member,
  orgSlug,
  isOwner,
}: MemberRowProps): React.JSX.Element {
  const [removeDialogOpen, setRemoveDialogOpen] = React.useState(false)
  const updateRoleMutation = useUpdateMemberRole()
  const removeMutation = useRemoveMember()

  const handleRoleChange = (newRole: string) => {
    updateRoleMutation.mutate({
      orgSlug,
      userId: member.user_id,
      role: newRole as "member" | "owner",
    })
  }

  const handleRemove = () => {
    setRemoveDialogOpen(true)
  }

  const confirmRemove = () => {
    removeMutation.mutate({ orgSlug, userId: member.user_id })
    setRemoveDialogOpen(false)
  }

  const joinedAt = formatRelativeTime(member.invited_at)

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {member.user.display_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {member.user.display_name}
              {member.is_me && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (you)
                </span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {member.user.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isOwner && !member.is_me ? (
            <>
              <Select value={member.role} onValueChange={handleRoleChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemove}
                disabled={removeMutation.isPending}
              >
                <RiDeleteBin6Line className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Badge variant="outline">{member.role}</Badge>
              <div className="w-32 text-right text-xs text-muted-foreground">
                Joined {joinedAt}
              </div>
            </>
          )}
        </div>
      </div>

      <RemoveMemberDialog
        open={removeDialogOpen}
        member={member}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveDialogOpen(false)}
        isLoading={removeMutation.isPending}
      />
    </>
  )
}
