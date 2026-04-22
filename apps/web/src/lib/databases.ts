// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────

export type DbKind = "postgres" | "redis" | "mongo"
export type DbPlan = "small" | "medium" | "large"
export type DbStatus = "creating" | "running" | "stopped" | "failed"

export interface Database {
  id: string
  project_id: string
  kind: DbKind
  name: string
  plan: DbPlan
  status: DbStatus
  host: string | null
  port: number | null
  rotation_schedule: "manual" | "30d" | "60d" | "90d"
  rotation_in_progress: boolean
  password_rotated_at: string | null
  created_at: string
  linked_apps?: Array<{ app_id: string; env_prefix: string }>
}

export interface CreateDatabaseInput {
  projectId: string
  kind: DbKind
  name: string
  plan: DbPlan
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const databaseKeys = {
  all: ["databases"] as const,
  list: (projectId?: string) => ["databases", "list", projectId ?? "all"] as const,
  detail: (id: string) => ["databases", "detail", id] as const,
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useDatabases(projectId?: string) {
  return useQuery({
    queryKey: databaseKeys.list(projectId),
    queryFn: async () => {
      const url = projectId ? `/databases?projectId=${projectId}` : "/databases"
      return apiFetch<Database[]>(url)
    },
  })
}

export function useDatabase(id: string) {
  return useQuery({
    queryKey: databaseKeys.detail(id),
    queryFn: async () => apiFetch<Database>(`/databases/${id}`),
    enabled: Boolean(id),
  })
}

export function useCreateDatabase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateDatabaseInput) => {
      return apiFetch<{ id: string }>("/databases", {
        method: "POST",
        body: input,
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: databaseKeys.list(vars.projectId) })
      toast.success("Database created")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useDeleteDatabase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return apiFetch<{ ok: boolean }>(`/databases/${id}`, {
        method: "DELETE",
        body: { confirm: `delete ${name}` },
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: databaseKeys.all })
      toast.success("Database deleted")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useRevealDatabase() {
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await apiFetch<{ connection_string: string }>(`/databases/${id}/reveal`, {
        method: "POST",
      })
      return data.connection_string
    },
  })
}

export function useLinkDatabase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      appId,
      databaseId,
      env_prefix,
    }: {
      appId: string
      databaseId: string
      env_prefix?: string
    }) => {
      return apiFetch<{ ok: boolean; vars: string[] }>(`/apps/${appId}/databases/${databaseId}/link`, {
        method: "POST",
        body: { env_prefix: env_prefix ?? "DATABASE" },
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["secrets", vars.appId] })
      qc.invalidateQueries({ queryKey: databaseKeys.all })
      toast.success("Database linked to app")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useRotateDatabase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      return apiFetch<{ ok: boolean; rotatedAt: string; appsRedeployed: string[] }>(
        `/databases/${id}/rotate`,
        { method: "POST" },
      )
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: databaseKeys.detail(id) })
      toast.success("Password rotation started — apps will be redeployed")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useUnlinkDatabase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ appId, databaseId }: { appId: string; databaseId: string }) => {
      return apiFetch<{ ok: boolean }>(`/apps/${appId}/databases/${databaseId}/link`, {
        method: "DELETE",
      })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["secrets", vars.appId] })
      qc.invalidateQueries({ queryKey: databaseKeys.all })
      toast.success("Database unlinked")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
