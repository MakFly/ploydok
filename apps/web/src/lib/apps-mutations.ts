// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ApiError } from "./api"
import type { AppDetail, AppListItem, AppSettingsPatch, RawAppDetail } from "./apps"
import { normalizeAppDetail } from "./apps"
import { notifyMutationError } from "./second-factor-toast"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// useDeployApp
// ---------------------------------------------------------------------------

export interface DeployOptions {
  rebuild?: boolean
  noCache?: boolean
}

export function useDeployApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<{ jobId: string }, ApiError, DeployOptions | void>({
    mutationFn: (opts) =>
      apiFetch<{ jobId: string }>(`/apps/${appId}/deploy`, {
        method: "POST",
        body: opts && (opts.rebuild || opts.noCache) ? opts : undefined,
      }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["apps", appId] })
      const snapshot = qc.getQueryData<AppDetail>(["apps", appId])
      if (snapshot) {
        qc.setQueryData<AppDetail>(["apps", appId], { ...snapshot, status: "building" })
      }
      qc.setQueryData<Array<AppListItem> | undefined>(
        ["apps"],
        (current) => current?.map((app) => (app.id === appId ? { ...app, status: "building" } : app)),
      )
      return { snapshot }
    },
    onError: (err, _vars, context) => {
      notifyMutationError(err, "Deployment failed to start")
      const ctx = context as { snapshot?: AppDetail } | undefined
      if (ctx?.snapshot) {
        qc.setQueryData(["apps", appId], ctx.snapshot)
      }
      void qc.invalidateQueries({ queryKey: ["apps"] })
    },
    onSuccess: () => {
      toast.success("Deployment queued")
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })
      void qc.invalidateQueries({ queryKey: ["apps"] })
    },
  })
}

// ---------------------------------------------------------------------------
// useRollbackApp
// ---------------------------------------------------------------------------

export interface RollbackOptions {
  /** When provided, rollback to this specific succeeded build. Omit for legacy (previous build). */
  buildId?: string
}

export function useRollbackApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, ApiError, RollbackOptions | void>({
    mutationFn: (opts) =>
      apiFetch<{ ok: boolean }>(`/apps/${appId}/rollback`, {
        method: "POST",
        body: opts?.buildId ? { buildId: opts.buildId } : undefined,
      }),
    onSuccess: () => {
      toast.success("Rollback started")
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })
    },
    onError: (error) => {
      notifyMutationError(error, "Rollback failed")
    },
  })
}

// ---------------------------------------------------------------------------
// useStopApp
// ---------------------------------------------------------------------------

export function useStopApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}/stop`, { method: "POST" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["apps", appId] })
      const snapshot = qc.getQueryData<AppDetail>(["apps", appId])
      if (snapshot) {
        qc.setQueryData<AppDetail>(["apps", appId], { ...snapshot, status: "stopped" })
      }
      return { snapshot }
    },
    onError: (err, _vars, context) => {
      notifyMutationError(err, "Stop failed")
      const ctx = context as { snapshot?: AppDetail } | undefined
      if (ctx?.snapshot) {
        qc.setQueryData(["apps", appId], ctx.snapshot)
      }
    },
    onSuccess: () => {
      toast.success("App stopped")
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })
      void qc.invalidateQueries({ queryKey: ["apps"] })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
    },
  })
}

// ---------------------------------------------------------------------------
// useRestartApp
// ---------------------------------------------------------------------------

export function useRestartApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}/restart`, { method: "POST" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["apps", appId] })
      const snapshot = qc.getQueryData<AppDetail>(["apps", appId])
      if (snapshot) {
        qc.setQueryData<AppDetail>(["apps", appId], { ...snapshot, status: "restarting" })
      }
      return { snapshot }
    },
    onError: (err, _vars, context) => {
      notifyMutationError(err, "Restart failed")
      const ctx = context as { snapshot?: AppDetail } | undefined
      if (ctx?.snapshot) {
        qc.setQueryData(["apps", appId], ctx.snapshot)
      }
    },
    onSuccess: () => {
      toast.success("Restart started")
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })
      void qc.invalidateQueries({ queryKey: ["apps"] })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteApp
// ---------------------------------------------------------------------------

export interface DeleteAppFlags {
  /** Wipe registry images + reclaim blobs. Default true. */
  deleteImages?: boolean
  /** Stop + force-remove Docker containers. Default true. */
  dockerCleanup?: boolean
  /** rm -rf the on-disk build workspace. Default true. */
  deleteBuildArtifacts?: boolean
  /** Remove the Caddy upstream/route. Default true. */
  deleteCaddyRoutes?: boolean
}

export function useDeleteApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean; jobId: string; status: string }, ApiError, DeleteAppFlags | void>({
    mutationFn: (flags) => {
      const params = new URLSearchParams()
      if (flags) {
        for (const [k, v] of Object.entries(flags)) {
          if (typeof v === "boolean") params.set(k, String(v))
        }
      }
      const qs = params.toString()
      return apiFetch<{ ok: boolean; jobId: string; status: string }>(
        `/apps/${appId}${qs ? `?${qs}` : ""}`,
        { method: "DELETE" },
      )
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps"] })
    },
    onError: (error) => {
      notifyMutationError(error, "Delete failed")
    },
  })
}

// ---------------------------------------------------------------------------
// usePruneRegistry
// ---------------------------------------------------------------------------

export interface GcResult {
  reposScanned: number
  tagsDeleted: number
  bytesFreed: number
}

export function usePruneRegistry(appId: string) {
  const qc = useQueryClient()
  return useMutation<GcResult, ApiError, void>({
    mutationFn: () =>
      apiFetch<GcResult>(`/apps/${appId}/registry-gc`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId, "registry-usage"] })
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })
    },
    onError: (error) => {
      notifyMutationError(error, "Registry GC failed")
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateAppSettings
// ---------------------------------------------------------------------------

export function useUpdateAppSettings(appId: string) {
  const qc = useQueryClient()
  return useMutation<AppDetail, ApiError, AppSettingsPatch>({
    mutationFn: async (body) => {
      const { healthcheckPath, healthcheckPort, restartPolicy, ...rest } = body
      const payload: Record<string, unknown> = { ...rest }
      if (restartPolicy !== undefined) payload.restartPolicy = restartPolicy
      if (healthcheckPath !== undefined || healthcheckPort !== undefined) {
        const healthcheck: Record<string, unknown> = {}
        if (healthcheckPath !== undefined) healthcheck.path = healthcheckPath ?? undefined
        if (healthcheckPort !== undefined) healthcheck.port = healthcheckPort ?? undefined
        payload.healthcheck = healthcheck
      }
      const { app } = await apiFetch<{ app: RawAppDetail; builds: Array<unknown> }>(
        `/apps/${appId}`,
        { method: "PATCH", body: payload },
      )
      return normalizeAppDetail(app)
    },
    onSuccess: (updated) => {
      toast.success("Settings saved")
      qc.setQueryData(["apps", appId], updated)
      void qc.invalidateQueries({ queryKey: ["apps"] })
    },
    onError: (error) => {
      notifyMutationError(error, "Settings save failed")
    },
  })
}
