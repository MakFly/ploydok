// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ApiError } from "./api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvVar {
  key: string
  /** Value may be "********" when secret=true (masked by the API). */
  value: string
  secret: boolean
}

interface EnvVarsResponse {
  vars: Array<EnvVar>
}

export interface EnvVarPatch {
  key: string
  value: string
  secret: boolean
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export function envVarsQueryKey(appId: string) {
  return ["apps", appId, "env"] as const
}

// ---------------------------------------------------------------------------
// useEnvVars — GET /apps/:id/env
// ---------------------------------------------------------------------------

export function useEnvVars(appId: string) {
  return useQuery<Array<EnvVar>, ApiError>({
    queryKey: envVarsQueryKey(appId),
    queryFn: async () => {
      const data = await apiFetch<EnvVarsResponse>(`/apps/${appId}/env`)
      return data.vars
    },
    enabled: Boolean(appId),
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// useUpdateEnvVars — PATCH /apps/:id/env
// ---------------------------------------------------------------------------

export function useUpdateEnvVars(appId: string) {
  const qc = useQueryClient()

  return useMutation<Array<EnvVar>, ApiError, Array<EnvVarPatch>>({
    mutationFn: async (vars) => {
      const data = await apiFetch<EnvVarsResponse>(`/apps/${appId}/env`, {
        method: "PATCH",
        body: { vars },
        headers: { "content-type": "application/json" },
      })
      return data.vars
    },
    onSuccess: (freshVars) => {
      // Push the response directly into cache — avoids an extra GET round-trip.
      qc.setQueryData(envVarsQueryKey(appId), freshVars)
    },
  })
}
