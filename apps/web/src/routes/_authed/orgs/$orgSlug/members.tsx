// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { RiAddLine } from "@remixicon/react"
import { Badge } from "@workspace/ui/components/badge"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"
import { MemberRow } from "../../../../components/members/MemberRow"
import { InviteDialog } from "../../../../components/members/InviteDialog"
import {
  
  
  useMembers,
  useRevokeInvitation
} from "../../../../lib/memberships"
import type {Invitation, Member} from "../../../../lib/memberships";


export const Route = createFileRoute("/_authed/orgs/$orgSlug/members")({
  component: MembersPage,
})

function MembersPage(): React.JSX.Element {
  const { orgSlug } = Route.useParams()
  const [inviteOpen, setInviteOpen] = React.useState(false)

  const { data, isLoading, error } = useMembers(orgSlug)
  const members: Array<Member> = data?.members ?? []
  const invitations: Array<Invitation> = data?.invitations ?? []

  const currentMember = members.find((m) => m.is_me)
  const isOwner = currentMember?.role === "owner"

  return (
    <ShellPage
      title="Members"
      description="Manage who has access to this workspace and their permission level."
      eyebrow="Workspace"
      actions={
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <RiAddLine className="h-4 w-4" />
          Invite a member
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Members section */}
        <ShellPanel
          title="Members"
          description="All members in this workspace."
        >
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-border bg-muted"
                />
              ))}
            </div>
          ) : error ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              Failed to load members.
            </p>
          ) : members.length > 0 ? (
            <div className="space-y-3">
              {members.map((member) => (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  orgSlug={orgSlug}
                  isOwner={isOwner}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
              <p className="text-sm font-semibold text-foreground">
                No members yet
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Invite your first member to collaborate.
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  Invite a member
                </Button>
              </div>
            </div>
          )}
        </ShellPanel>

        {/* Pending invitations section */}
        {invitations.length > 0 && (
          <ShellPanel
            title="Pending invitations"
            description="Invitations waiting to be accepted."
          >
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <PendingInvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  orgSlug={orgSlug}
                  isOwner={isOwner}
                />
              ))}
            </div>
          </ShellPanel>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        orgSlug={orgSlug}
        onClose={() => setInviteOpen(false)}
      />
    </ShellPage>
  )
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

interface PendingInvitationRowProps {
  invitation: Invitation
  orgSlug: string
  isOwner: boolean
}

function PendingInvitationRow({
  invitation,
  orgSlug,
  isOwner,
}: PendingInvitationRowProps): React.JSX.Element {
  const revokeMutation = useRevokeInvitation()

  const expiresIn = formatRelativeTime(invitation.expires_at)

  const handleRevoke = () => {
    revokeMutation.mutate({ orgSlug, invitationId: invitation.id })
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">
          {invitation.email}
        </p>
        <p className="text-xs text-muted-foreground">Expires {expiresIn}</p>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="secondary">{invitation.role}</Badge>
        {isOwner && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRevoke}
            disabled={revokeMutation.isPending}
          >
            Revoke
          </Button>
        )}
      </div>
    </div>
  )
}
