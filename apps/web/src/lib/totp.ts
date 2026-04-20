// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ApiError } from "./api"

export interface TotpEnrollResponse {
  otpauthUrl: string
  // NOTE: secret is returned for display fallback (copy-paste), NEVER logged
  secret: string
}

export interface TotpStatus {
  enrolled: boolean
  verified: boolean
}

/** Fetch current TOTP enrollment status for the authed user. */
export function useTotpStatus() {
  return useQuery<TotpStatus, ApiError>({
    queryKey: ["totp", "status"],
    queryFn: async () => {
      const me = await apiFetch<{ has_totp: boolean }>("/me")
      // Simplification: if has_totp is true the secret is enrolled AND verified.
      // An in-progress (unverified) enroll is tracked locally by the component.
      return { enrolled: me.has_totp, verified: me.has_totp }
    },
  })
}

/** Start enrollment: server generates secret + otpauth URL. */
export function useEnrollTotp() {
  return useMutation<TotpEnrollResponse, ApiError, void>({
    mutationFn: async () => {
      return apiFetch<TotpEnrollResponse>("/auth/totp/enroll", { method: "POST" })
    },
  })
}

/** Verify the first code post-enrollment. */
export function useVerifyTotp() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, { code: string }>({
    mutationFn: async ({ code }) => {
      await apiFetch<{ ok: true }>("/auth/totp/verify", {
        method: "POST",
        body: { code },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["totp", "status"] })
      qc.invalidateQueries({ queryKey: ["me"] })
    },
  })
}

/** Remove TOTP enrollment. */
export function useDeleteTotp() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiFetch<void>("/auth/totp", { method: "DELETE" })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["totp", "status"] })
      qc.invalidateQueries({ queryKey: ["me"] })
    },
  })
}
