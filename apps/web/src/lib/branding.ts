// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import { toast } from "sonner"
import type { OrgBranding, UpdateOrgBranding } from "@ploydok/shared"

export function useOrgBranding(orgSlug: string | undefined) {
  return useQuery({
    queryKey: ["org-branding", orgSlug],
    queryFn: async () => {
      if (!orgSlug) return null
      return apiFetch<{ branding: OrgBranding }>(
        `/orgs/${orgSlug}/branding`
      ).then((data) => data.branding)
    },
    enabled: !!orgSlug,
  })
}

export function useUpdateOrgBranding(orgSlug: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (updates: UpdateOrgBranding) => {
      if (!orgSlug) throw new Error("No organization slug")
      return apiFetch<{ branding: OrgBranding }>(`/orgs/${orgSlug}/branding`, {
        method: "PUT",
        body: updates,
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["org-branding", orgSlug], data.branding)
      toast.success("Branding updated successfully")
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update branding"
      )
    },
  })
}

export function useDeleteOrgBranding(orgSlug: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!orgSlug) throw new Error("No organization slug")
      return apiFetch<{ success: boolean }>(`/orgs/${orgSlug}/branding`, {
        method: "DELETE",
      })
    },
    onSuccess: () => {
      queryClient.setQueryData(["org-branding", orgSlug], {
        org_id: orgSlug,
        app_name: "Ploydok",
        logo_url: null,
        primary_color: null,
        favicon_url: null,
      })
      toast.success("Branding reset to defaults")
    },
    onError: () => {
      toast.error("Failed to reset branding")
    },
  })
}
