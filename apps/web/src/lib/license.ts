// SPDX-License-Identifier: AGPL-3.0-only
import {
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { apiFetch } from "./api"
import type {
  LicenseStatus,
  LicenseActivateRequest,
  LicenseActivateResponse,
} from "@ploydok/shared"

const LICENSE_STATUS_QUERY_KEY = ["license", "status"]

/**
 * Hook to fetch and watch license status.
 */
export function useLicenseStatus() {
  return useSuspenseQuery({
    queryKey: LICENSE_STATUS_QUERY_KEY,
    queryFn: async (): Promise<LicenseStatus> => {
      return apiFetch<LicenseStatus>("/license/status")
    },
  })
}

/**
 * Hook to activate a license.
 */
export function useActivateLicense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      req: LicenseActivateRequest
    ): Promise<LicenseActivateResponse> => {
      return apiFetch<LicenseActivateResponse>("/license/activate", {
        method: "POST",
        body: JSON.stringify(req),
        headers: { "Content-Type": "application/json" },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LICENSE_STATUS_QUERY_KEY })
    },
  })
}
