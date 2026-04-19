// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ApiError } from "./api"
import type { AppDetail, AppListItem, AppSettingsPatch, RawAppDetail } from "./apps"
import { normalizeAppDetail } from "./apps"
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
    onError: (_err, _vars, context) => {
      toast.error("Deployment failed to start")
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
      toast.error(error.message)
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
    onError: (_err, _vars, context) => {
      toast.error("Stop failed")
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
    onError: (_err, _vars, context) => {
      toast.error("Restart failed")
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

export function useDeleteApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps"] })
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
      toast.error(error.message)
    },
  })
}
