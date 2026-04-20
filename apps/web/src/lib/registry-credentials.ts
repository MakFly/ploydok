// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { apiFetch } from "./api"
import type { ApiError } from "./api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryCredential {
  id: string
  label: string
  registryHost: string
  username: string
  createdAt?: string
}

interface ListResponse {
  credentials: Array<RegistryCredential>
}

export interface CreateRegistryCredentialPayload {
  label: string
  registryHost: string
  username: string
  password: string
}

interface CreateResponse {
  id: string
  label: string
  registryHost: string
  username: string
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useRegistryCredentials() {
  return useQuery<Array<RegistryCredential>, ApiError>({
    queryKey: ["registry", "credentials"],
    queryFn: async () => {
      const res = await apiFetch<ListResponse>("/registry/credentials")
      return res.credentials
    },
    staleTime: 30_000,
  })
}

export function useCreateRegistryCredential() {
  const qc = useQueryClient()
  return useMutation<CreateResponse, ApiError, CreateRegistryCredentialPayload>({
    mutationFn: (payload) =>
      apiFetch<CreateResponse>("/registry/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Registry credential saved")
      void qc.invalidateQueries({ queryKey: ["registry", "credentials"] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useDeleteRegistryCredential() {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, ApiError, string>({
    mutationFn: (id) =>
      apiFetch<{ ok: true }>(`/registry/credentials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Credential deleted")
      void qc.invalidateQueries({ queryKey: ["registry", "credentials"] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}
