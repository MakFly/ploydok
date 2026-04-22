// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ApiError } from "./api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecretScope = "shared" | "prod" | "preview" | "dev"

export interface SecretMeta {
  key: string
  scope: SecretScope
  updated_at: string | null
}

interface SecretsResponse {
  secrets: SecretMeta[]
}

export interface CreateSecretPayload {
  key: string
  value: string
  scope: SecretScope
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export function secretsQueryKey(appId: string, scope?: SecretScope) {
  return scope ? (["apps", appId, "secrets", scope] as const) : (["apps", appId, "secrets"] as const)
}

// ---------------------------------------------------------------------------
// useSecrets — GET /apps/:id/secrets?scope=
// ---------------------------------------------------------------------------

export function useSecrets(appId: string, scope?: SecretScope) {
  return useQuery<SecretMeta[], ApiError>({
    queryKey: secretsQueryKey(appId, scope),
    queryFn: async () => {
      const qs = scope ? `?scope=${scope}` : ""
      const data = await apiFetch<SecretsResponse>(`/apps/${appId}/secrets${qs}`)
      return data.secrets
    },
    enabled: Boolean(appId),
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// useCreateSecret — POST /apps/:id/secrets
// ---------------------------------------------------------------------------

export function useCreateSecret(appId: string) {
  const qc = useQueryClient()

  return useMutation<{ key: string; scope: SecretScope }, ApiError, CreateSecretPayload>({
    mutationFn: async (payload) => {
      return apiFetch(`/apps/${appId}/secrets`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apps", appId, "secrets"] })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteSecret — DELETE /apps/:id/secrets/:key?scope=
// ---------------------------------------------------------------------------

export function useDeleteSecret(appId: string) {
  const qc = useQueryClient()

  return useMutation<unknown, ApiError, { key: string; scope: SecretScope }>({
    mutationFn: async ({ key, scope }) => {
      return apiFetch(`/apps/${appId}/secrets/${encodeURIComponent(key)}?scope=${scope}`, {
        method: "DELETE",
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apps", appId, "secrets"] })
    },
  })
}

// ---------------------------------------------------------------------------
// useRevealSecret — POST /apps/:id/secrets/:key/reveal?scope=
// ---------------------------------------------------------------------------

export function useRevealSecret(appId: string) {
  return useMutation<{ value: string }, ApiError, { key: string; scope: SecretScope; totpCode: string }>({
    mutationFn: async ({ key, scope, totpCode }) => {
      return apiFetch(`/apps/${appId}/secrets/${encodeURIComponent(key)}/reveal?scope=${scope}`, {
        method: "POST",
        headers: { "X-TOTP-Code": totpCode },
        body: JSON.stringify({}),
      })
    },
  })
}

// ---------------------------------------------------------------------------
// useImportEnv — POST /apps/:id/secrets/import
// ---------------------------------------------------------------------------

export function useImportEnv(appId: string) {
  const qc = useQueryClient()

  return useMutation<{ imported: number }, ApiError, { file: File; scope?: SecretScope }>({
    mutationFn: async ({ file, scope }) => {
      const content = await file.text()
      const qs = scope ? `?scope=${scope}` : ""
      return apiFetch<{ imported: number }>(`/apps/${appId}/secrets/import${qs}`, {
        method: "POST",
        body: { content },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apps", appId, "secrets"] })
    },
  })
}
