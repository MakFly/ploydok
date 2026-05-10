// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { apiFetch } from "./api"
import { notifyMutationError } from "./second-factor-toast"
import type {
  InvitationAcceptResponse,
  InvitationPreview,
  InvitationRow,
  InviteBody,
  MemberListItem,
} from "@ploydok/shared"

// ── Types (Re-export for convenience) ────────────────────────────────────────

export type { InviteBody, InvitationPreview } from "@ploydok/shared"

export interface Member extends MemberListItem {
  is_me: boolean
}

export interface Invitation extends InvitationRow {}

interface MembersApiResponse {
  members: Array<MemberListItem & { is_me: boolean }>
  pending_invitations: Array<InvitationRow>
}

export function mapMembersResponse(response: MembersApiResponse): {
  members: Array<MemberListItem & { is_me: boolean }>
  invitations: Array<InvitationRow>
} {
  return {
    members: response.members,
    invitations: response.pending_invitations,
  }
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const membershipKeys = {
  all: ["memberships"] as const,
  list: (orgSlug?: string) =>
    ["memberships", "list", orgSlug ?? "all"] as const,
  invitationPreview: (token: string) =>
    ["invitations", "preview", token] as const,
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useMembers(orgSlug: string) {
  return useQuery({
    queryKey: membershipKeys.list(orgSlug),
    queryFn: async () => {
      const response = await apiFetch<MembersApiResponse>(
        `/orgs/${orgSlug}/members`
      )
      return mapMembersResponse(response)
    },
    enabled: Boolean(orgSlug),
  })
}

export function useInviteMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orgSlug,
      email,
      role,
    }: {
      orgSlug: string
    } & InviteBody) => {
      return apiFetch<{
        invitation: {
          id: string
          email: string
          role: string
          expires_at: string
        }
      }>(`/orgs/${orgSlug}/members/invite`, {
        method: "POST",
        body: { email, role },
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: membershipKeys.list(vars.orgSlug) })
      toast.success(`Invitation sent to ${vars.email}`)
    },
    onError: (err: Error) => {
      notifyMutationError(err, "Failed to send invitation")
    },
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orgSlug,
      userId,
    }: {
      orgSlug: string
      userId: string
    }) => {
      return apiFetch<{ ok: boolean }>(`/orgs/${orgSlug}/members/${userId}`, {
        method: "DELETE",
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: membershipKeys.list(vars.orgSlug) })
      toast.success("Member removed")
    },
    onError: (err: Error) => {
      notifyMutationError(err, "Failed to remove member")
    },
  })
}

export function useUpdateMemberRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orgSlug,
      userId,
      role,
    }: {
      orgSlug: string
      userId: string
      role: "owner" | "member"
    }) => {
      return apiFetch<{ ok: boolean }>(
        `/orgs/${orgSlug}/members/${userId}/role`,
        {
          method: "PATCH",
          body: { role },
          headers: { "content-type": "application/json" },
        }
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: membershipKeys.list(vars.orgSlug) })
      toast.success("Member role updated")
    },
    onError: (err: Error) => {
      notifyMutationError(err, "Failed to update member role")
    },
  })
}

export function useRevokeInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orgSlug,
      invitationId,
    }: {
      orgSlug: string
      invitationId: string
    }) => {
      return apiFetch<{ ok: boolean }>(
        `/orgs/${orgSlug}/invitations/${invitationId}`,
        {
          method: "DELETE",
        }
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: membershipKeys.list(vars.orgSlug) })
      toast.success("Invitation revoked")
    },
    onError: (err: Error) => {
      notifyMutationError(err, "Failed to revoke invitation")
    },
  })
}

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: membershipKeys.invitationPreview(token),
    queryFn: async () =>
      apiFetch<InvitationPreview>(`/invitations/preview?token=${token}`),
    enabled: Boolean(token),
  })
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async ({ token }: { token: string }) => {
      return apiFetch<InvitationAcceptResponse>("/invitations/accept", {
        method: "POST",
        body: { token },
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: () => {
      toast.success("Invitation accepted!")
    },
    onError: (err: Error) => {
      notifyMutationError(err, "Failed to accept invitation")
    },
  })
}
