// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { apiFetch } from "./api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitLabConfig {
  configured: boolean
  instance_url?: string
  client_id?: string
}

export interface SaveGitLabConfigPayload {
  instance_url?: string
  client_id: string
  client_secret: string
  webhook_secret: string
}

// ---------------------------------------------------------------------------
// Config (admin)
// ---------------------------------------------------------------------------

export function useGitLabConfig() {
  return useQuery<GitLabConfig>({
    queryKey: ["gitlab", "config"],
    queryFn: () => apiFetch<GitLabConfig>("/gitlab/config"),
    staleTime: 30_000,
  })
}

export function useSaveGitLabConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SaveGitLabConfigPayload) =>
      apiFetch<{ ok: true }>("/gitlab/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("GitLab OAuth app enregistrée")
      void qc.invalidateQueries({ queryKey: ["gitlab", "config"] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Erreur : ${msg}`)
    },
  })
}

export function useDeleteGitLabConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/gitlab/config", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Configuration GitLab supprimée")
      void qc.invalidateQueries({ queryKey: ["gitlab"] })
    },
  })
}

// ---------------------------------------------------------------------------
// OAuth connect/disconnect (per-user)
// ---------------------------------------------------------------------------

/**
 * Navigate the browser to /gitlab/connect so the server can set the state
 * cookie and redirect to {instance}/oauth/authorize. Cannot be done via
 * XHR — the browser must follow the 302.
 */
export function gitlabConnectUrl(): string {
  return "/gitlab/connect"
}

export function useDisconnectGitLab() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/gitlab/connect", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("GitLab déconnecté")
      void qc.invalidateQueries({ queryKey: ["gitlab"] })
    },
  })
}
