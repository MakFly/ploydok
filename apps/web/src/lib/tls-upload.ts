// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { apiFetch } from "./api"
import type { ApiError } from "./api"

export interface UploadCertResult {
  uploaded: boolean
  notBefore: string | null
  notAfter: string | null
  sans: Array<string>
}

export function useUploadCert(appId: string, domain: string) {
  const qc = useQueryClient()
  return useMutation<UploadCertResult, ApiError, { cert: string; key: string }>({
    mutationFn: (body) =>
      apiFetch<UploadCertResult>(`/apps/${appId}/domains/${domain}/tls/upload`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    onSuccess: () => {
      toast.success("Certificate uploaded successfully")
      qc.invalidateQueries({ queryKey: ["apps", appId, "domains"] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useDeleteCustomCert(appId: string, domain: string) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}/domains/${domain}/tls/custom`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Custom certificate removed — reverting to ACME")
      qc.invalidateQueries({ queryKey: ["apps", appId, "domains"] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}
