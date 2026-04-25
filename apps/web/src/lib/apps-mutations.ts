// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch, invalidateGetCache } from "./api"
import type { ApiError } from "./api"
import type {
  AppDetail,
  AppListItem,
  AppSettingsPatch,
  RawAppDetail,
} from "./apps"
import { normalizeAppDetail } from "./apps"
import { notifyMutationError } from "./second-factor-toast"
import { toast } from "sonner"
import { useEventsSubscribeFn } from "./events-provider"

// ---------------------------------------------------------------------------
// useTrackAppRestart
//
// Returns a `track()` callback that shows a toast.loading and resolves it on
// the next `deploy.status_change` SSE event for this appId with a terminal
// status (running → success, failed/stopped → error). A timeout dismisses
// the toast if no event arrives.
// ---------------------------------------------------------------------------

function useTrackAppRestart(appId: string): () => void {
  const subscribe = useEventsSubscribeFn()
  return React.useCallback(() => {
    if (!subscribe) return
    const toastId = `app-restart-${appId}`
    toast.loading("Redémarrage en cours…", { id: toastId })

    let unsubscribe: (() => void) | null = null
    const finish = () => {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      finish()
      toast.dismiss(toastId)
    }, 180_000)

    unsubscribe = subscribe("deploy.status_change", (data) => {
      const evt = data as {
        appId?: string
        data?: { status?: string }
      }
      if (evt.appId !== appId) return
      const status = evt.data?.status
      if (status === "running") {
        finish()
        toast.success("App redémarrée", { id: toastId })
      } else if (status === "failed") {
        finish()
        toast.error("Redémarrage échoué", { id: toastId })
      } else if (status === "stopped") {
        finish()
        toast.error("Redémarrage interrompu", { id: toastId })
      }
    })
  }, [appId, subscribe])
}

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
        qc.setQueryData<AppDetail>(["apps", appId], {
          ...snapshot,
          status: "building",
        })
      }
      qc.setQueryData<Array<AppListItem> | undefined>(["apps"], (current) =>
        current?.map((app) =>
          app.id === appId ? { ...app, status: "building" } : app
        )
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
// useCancelBuild
// ---------------------------------------------------------------------------

export function useCancelBuild(appId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, ApiError, { buildId: string }>({
    mutationFn: ({ buildId }) =>
      apiFetch<{ ok: boolean }>(`/apps/${appId}/builds/${buildId}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Deployment cancelled")
      void qc.invalidateQueries({ queryKey: ["apps", appId] })
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] })
    },
    onError: (error) => {
      notifyMutationError(error, "Cancel deployment failed")
    },
  })
}

// ---------------------------------------------------------------------------
// useStopApp
// ---------------------------------------------------------------------------

export function useStopApp(appId: string) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () => apiFetch<void>(`/apps/${appId}/stop`, { method: "POST" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["apps", appId] })
      const snapshot = qc.getQueryData<AppDetail>(["apps", appId])
      if (snapshot) {
        qc.setQueryData<AppDetail>(["apps", appId], {
          ...snapshot,
          status: "stopped",
        })
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
  const trackRestart = useTrackAppRestart(appId)
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}/restart`, { method: "POST" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["apps", appId] })
      const snapshot = qc.getQueryData<AppDetail>(["apps", appId])
      if (snapshot) {
        qc.setQueryData<AppDetail>(["apps", appId], {
          ...snapshot,
          status: "restarting",
        })
      }
      // The API returns 202 as soon as the prelude is committed; the heavy
      // work runs in the background and emits a `deploy.status_change` SSE
      // ("running" or "failed") when finished. Show a toast.loading now and
      // resolve it on the SSE event so the toast tracks the actual restart.
      trackRestart()
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
  return useMutation<
    { ok: boolean; jobId: string; status: string },
    ApiError,
    DeleteAppFlags | void,
    {
      snapshots: Array<[ReadonlyArray<unknown>, Array<AppListItem> | undefined]>
    }
  >({
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
        { method: "DELETE" }
      )
    },
    // Optimistic UI: remove the app from every cached ["apps", *] list right
    // away so the user sees it disappear instantly. The toast id matches the
    // SSE listener in useApps so the loading toast is upgraded to success on
    // app.deleted (or rolled back on app.delete.failed).
    onMutate: () => {
      const snapshots = qc
        .getQueriesData<Array<AppListItem>>({ queryKey: ["apps"] })
        .map(
          ([key, data]) =>
            [key as ReadonlyArray<unknown>, data] as [
              ReadonlyArray<unknown>,
              Array<AppListItem> | undefined,
            ]
        )
      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue
        qc.setQueryData<Array<AppListItem>>(
          key as Parameters<typeof qc.setQueryData>[0],
          data.filter((a) => a.id !== appId)
        )
      }
      toast.loading("Deleting app…", { id: `delete-app:${appId}` })
      return { snapshots }
    },
    onSuccess: () => {
      // Bust apiFetch's module-level GET cache for the apps list — without
      // this, the in-memory Promise from a previous /apps?organizationId=…
      // fetch is replayed and the deleted app reappears until hard refresh.
      // Note: the cascade is async on the server (job queue) — final cache
      // eviction + success toast happen on the SSE app.deleted event handled
      // by useApps below.
      invalidateGetCache()
      qc.removeQueries({ queryKey: ["apps", appId] })
    },
    onError: (error, _vars, ctx) => {
      // Rollback the optimistic remove.
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots) {
          qc.setQueryData(key as Parameters<typeof qc.setQueryData>[0], data)
        }
      }
      toast.dismiss(`delete-app:${appId}`)
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
  const trackRestart = useTrackAppRestart(appId)
  return useMutation<
    { app: AppDetail; restartTriggered: boolean },
    ApiError,
    AppSettingsPatch,
    { toastId: string }
  >({
    mutationFn: async (body) => {
      const { healthcheckPath, healthcheckPort, restartPolicy, ...rest } = body
      const payload: Record<string, unknown> = { ...rest }
      if (restartPolicy !== undefined) payload.restartPolicy = restartPolicy
      if (healthcheckPath !== undefined || healthcheckPort !== undefined) {
        const healthcheck: Record<string, unknown> = {}
        if (healthcheckPath !== undefined)
          healthcheck.path = healthcheckPath ?? undefined
        if (healthcheckPort !== undefined)
          healthcheck.port = healthcheckPort ?? undefined
        payload.healthcheck = healthcheck
      }
      const { app, restartTriggered } = await apiFetch<{
        app: RawAppDetail
        restartTriggered?: boolean
      }>(`/apps/${appId}`, { method: "PATCH", body: payload })
      return {
        app: normalizeAppDetail(app),
        restartTriggered: restartTriggered ?? false,
      }
    },
    onMutate: () => {
      const toastId = `app-settings-${appId}`
      toast.loading("Saving settings…", { id: toastId })
      return { toastId }
    },
    onSuccess: ({ app, restartTriggered }, _vars, ctx) => {
      toast.success("Settings saved", { id: ctx.toastId })
      qc.setQueryData(["apps", appId], app)
      void qc.invalidateQueries({ queryKey: ["apps"] })
      // The PATCH may have triggered a background restart (e.g. restartPolicy
      // changed on a running app). Show a separate toast that tracks the
      // restart progress via the next SSE deploy.status_change event.
      if (restartTriggered) trackRestart()
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.toastId) toast.dismiss(ctx.toastId)
      notifyMutationError(error, "Settings save failed")
    },
  })
}
