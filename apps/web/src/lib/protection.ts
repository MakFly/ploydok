// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ApiError } from "./api"
import { toast } from "sonner"

export interface ProtectionConfig {
  basicAuth: {
    enabled: boolean
    user: string | null
  }
  ipAllowlist: string[]
  rateLimitRps: number | null
}

export interface ProtectionPatch {
  basicAuth?: {
    enabled: boolean
    user?: string
    pass?: string
  }
  ipAllowlist?: string[]
  rateLimitRps?: number | null
}

export function useProtection(appId: string) {
  return useQuery<ProtectionConfig, ApiError>({
    queryKey: ["apps", appId, "protection"],
    queryFn: () => apiFetch<ProtectionConfig>(`/apps/${appId}/protection`),
    staleTime: 30_000,
    enabled: Boolean(appId),
  })
}

export function useUpdateProtection(appId: string) {
  const qc = useQueryClient()
  return useMutation<ProtectionConfig, ApiError, ProtectionPatch>({
    mutationFn: (body) =>
      apiFetch<ProtectionConfig>(`/apps/${appId}/protection`, {
        method: "PATCH",
        body,
        headers: { "content-type": "application/json" },
      }),
    onSuccess: (data) => {
      qc.setQueryData(["apps", appId, "protection"], data)
      toast.success("Protection settings saved")
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useRevealBasicAuth(appId: string) {
  return useMutation<{ user: string; pass: string }, ApiError, void>({
    mutationFn: () =>
      apiFetch<{ user: string; pass: string }>(
        `/apps/${appId}/protection/basic-auth/reveal`,
        { method: "POST", body: {}, headers: { "content-type": "application/json" } },
      ),
    onError: (err) => {
      toast.error(err.message)
    },
  })
}
