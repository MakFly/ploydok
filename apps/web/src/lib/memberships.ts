// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ApiError, apiFetch } from "./api"
import i18n from "./i18n"
import { notifyMutationError } from "./second-factor-toast"
import type {
  CreateInvitationResponse,
  InvitationAcceptResponse,
  InvitationPreview,
  InvitationRow,
  InviteBody,
  MemberListItem,
  RegisterFromInvitationBody,
  RegisterFromInvitationResponse,
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

export function invitationAcceptPath(token: string): string {
  const search = new URLSearchParams({ token })
  return `/invitations/accept?${search.toString()}`
}

export function isTerminalInvitationError(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 404 || error.status === 410)
  )
}

export function clearInvitationTokenOnTerminalError(
  storage: Pick<Storage, "removeItem">,
  error: unknown
): boolean {
  if (!isTerminalInvitationError(error)) return false
  storage.removeItem("ploydok.invitation-token")
  return true
}

export function invitationLoginPath(token: string): string {
  void token
  return `/login?redirect=${encodeURIComponent("/invitations/accept")}`
}

export function validateInvitationPasswords(
  password: string,
  confirmation: string
): string | null {
  if (password !== confirmation)
    return i18n.t("auth:invitation.passwordsMismatch")
  return null
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
      return apiFetch<CreateInvitationResponse>(
        `/orgs/${orgSlug}/members/invite`,
        {
          method: "POST",
          body: { email, role },
          headers: { "content-type": "application/json" },
        }
      )
    },
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: membershipKeys.list(vars.orgSlug) })
      toast.success(
        result.delivery_status === "delivered"
          ? i18n.t("workspace:members.inviteDelivered", { email: vars.email })
          : i18n.t("workspace:members.inviteQueued", { email: vars.email })
      )
    },
    onError: (err: Error) => {
      notifyMutationError(err, i18n.t("workspace:members.inviteFailed"))
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
      toast.success(i18n.t("workspace:members.removed"))
    },
    onError: (err: Error) => {
      notifyMutationError(err, i18n.t("workspace:members.removeFailed"))
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
      toast.success(i18n.t("workspace:members.roleUpdated"))
    },
    onError: (err: Error) => {
      notifyMutationError(err, i18n.t("workspace:members.roleFailed"))
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
      toast.success(i18n.t("workspace:members.invitationRevoked"))
    },
    onError: (err: Error) => {
      notifyMutationError(err, i18n.t("workspace:members.revokeFailed"))
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
      toast.success(i18n.t("workspace:members.invitationAccepted"))
    },
    onError: (err: Error) => {
      notifyMutationError(err, i18n.t("workspace:members.acceptFailed"))
    },
  })
}

export function useRegisterFromInvitation() {
  return useMutation({
    mutationFn: async (body: RegisterFromInvitationBody) =>
      apiFetch<RegisterFromInvitationResponse>("/invitations/register", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    onError: (err: Error) => {
      notifyMutationError(err, i18n.t("workspace:members.createFailed"))
    },
  })
}
