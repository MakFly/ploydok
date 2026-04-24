// SPDX-License-Identifier: AGPL-3.0-only
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import type { AppConfig, Build, CaddyExtraHandlers } from "@ploydok/shared"
import {
  apiFetch,
  criticalRetryDelay,
  invalidateGetCache,
  shouldRetryCriticalQuery,
} from "../api"
import type { ApiError } from "../api"
import { useEventsSubscription } from "../events-provider"
import {
  normalizeAppDetail,
  applyAppStatus,
  getEventAppStatus,
} from "./transforms"
import type {
  AppDetail,
  AppListItem,
  AppsResponse,
  AppStatusEventPayload,
  BuildsResponse,
  BuildWithApp,
  RawAppDetail,
  RegistryUsage,
  UseAppOptions,
  UseBuildsOptions,
} from "./types"

export function useApps(organizationId?: string) {
  return useQuery<Array<AppListItem>, ApiError>({
    queryKey: ["apps", organizationId ?? "all"],
    queryFn: async () => {
      const query = organizationId
        ? `?organizationId=${encodeURIComponent(organizationId)}`
        : ""
      const data = await apiFetch<AppsResponse>(`/apps${query}`)
      return data.apps
    },
    staleTime: 30_000,
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    meta: { critical: true },
  })
}

export function useCreateApp() {
  const qc = useQueryClient()
  return useMutation<AppListItem, ApiError, Partial<AppConfig>>({
    mutationFn: (body) =>
      apiFetch<AppListItem>("/apps", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    onSuccess: (_, vars) => {
      toast.success("App created")
      qc.invalidateQueries({ queryKey: ["apps"] })
      if (vars.organizationId ?? vars.projectId) {
        qc.invalidateQueries({
          queryKey: ["apps", vars.organizationId ?? vars.projectId],
        })
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useApp(appId: string, opts?: UseAppOptions) {
  const qc = useQueryClient()

  const syncStatus = (status: import("@ploydok/shared").AppStatus) => {
    qc.setQueryData<AppDetail | undefined>(
      ["apps", appId],
      (current) => applyAppStatus(current, status) as AppDetail | undefined
    )
    qc.setQueryData<Array<AppListItem> | undefined>(["apps"], (current) =>
      current?.map((app) =>
        app.id === appId ? (applyAppStatus(app, status) as AppListItem) : app
      )
    )
  }

  const refetchApp = () => {
    invalidateGetCache(`/apps/${appId}`)
    void qc.invalidateQueries({ queryKey: ["apps", appId] })
    void qc.invalidateQueries({ queryKey: ["apps"] })
  }

  useEventsSubscription<AppStatusEventPayload>("build.started", (payload) => {
    if (payload.appId !== appId) return
    const status = getEventAppStatus(payload) ?? "building"
    syncStatus(status)
  })

  useEventsSubscription<AppStatusEventPayload>(
    "deploy.status_change",
    (payload) => {
      if (payload.appId !== appId) return
      const status = getEventAppStatus(payload)
      if (status) syncStatus(status)
      refetchApp()
    }
  )

  useEventsSubscription<AppStatusEventPayload>("build.failed", (payload) => {
    if (payload.appId !== appId) return
    refetchApp()
  })

  useEventsSubscription<AppStatusEventPayload>("build.succeeded", (payload) => {
    if (payload.appId !== appId) return
    refetchApp()
  })

  return useQuery<AppDetail, ApiError>({
    queryKey: ["apps", appId],
    queryFn: async () => {
      const { app, builds: rawBuilds } = await apiFetch<{
        app: RawAppDetail
        builds: Array<Build>
      }>(`/apps/${appId}`)
      const normalized = normalizeAppDetail(app)
      // Attach builds[] returned by the endpoint so consumers (e.g. LastDeploymentCard)
      // can derive the last build without a separate /builds request.
      return { ...normalized, builds: rawBuilds }
    },
    // Keep a generous staleTime to avoid redundant fetches, but refetch on
    // window focus so re-activating the tab reflects status changes promptly.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    enabled: Boolean(appId),
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    meta: { critical: true },
    ...(opts?.initialData !== undefined
      ? { initialData: opts.initialData }
      : {}),
  })
}

export function useBuilds(appId: string, opts?: UseBuildsOptions) {
  const qc = useQueryClient()

  // When a build-related event arrives, fetch the fresh list and push it
  // straight into the cache with setQueryData. qc.refetchQueries /
  // invalidateQueries proved unreliable here — both no-op when RQ considers
  // the query "fresh" and when multiple refetches are batched within a few
  // ms (replay). A direct fetch+setQueryData is deterministic.
  const syncFromServer = async () => {
    try {
      // Bust apiFetch's module-level GET cache before fetching — without this
      // we'd get the first response's cached Promise for the whole session.
      invalidateGetCache(`/apps/${appId}/builds`)
      invalidateGetCache(`/apps/${appId}`)
      const data = await apiFetch<BuildsResponse>(`/apps/${appId}/builds`)
      qc.setQueryData(["apps", appId, "builds"], data.builds)
    } catch {
      // A transient network error is fine — the next event will retry.
    }
  }

  useEventsSubscription("build.started", syncFromServer)
  useEventsSubscription("build.succeeded", syncFromServer)
  useEventsSubscription("build.failed", syncFromServer)
  useEventsSubscription("deploy.status_change", syncFromServer)

  return useQuery<Array<Build>, ApiError>({
    queryKey: ["apps", appId, "builds"],
    queryFn: async () => {
      const data = await apiFetch<BuildsResponse>(`/apps/${appId}/builds`)
      return data.builds
    },
    staleTime: 10_000,
    enabled: Boolean(appId),
    ...(opts?.initialData !== undefined
      ? { initialData: opts.initialData }
      : {}),
  })
}

export function useRegistryUsage(appId: string) {
  return useQuery<RegistryUsage, ApiError>({
    queryKey: ["apps", appId, "registry-usage"],
    queryFn: () => apiFetch<RegistryUsage>(`/apps/${appId}/registry-usage`),
    staleTime: 30_000,
    enabled: Boolean(appId),
  })
}

export function useRecentBuildsAcrossApps(
  apps: Array<AppListItem>,
  maxApps = 6
): { builds: Array<BuildWithApp>; isLoading: boolean } {
  const targets = apps.slice(0, maxApps)

  const results = useQueries({
    queries: targets.map((app) => ({
      queryKey: ["apps", app.id],
      queryFn: async (): Promise<AppDetail> => {
        const { app: raw, builds: rawBuilds } = await apiFetch<{
          app: RawAppDetail
          builds: Array<Build>
        }>(`/apps/${app.id}`)
        return { ...normalizeAppDetail(raw), builds: rawBuilds }
      },
      staleTime: 15_000,
      enabled: Boolean(app.id),
    })),
  })

  const isLoading = results.some((r) => r.isLoading)

  const builds: Array<BuildWithApp> = results
    .flatMap((r, idx) => {
      const detail = r.data
      if (!detail?.builds) return []
      const appName = targets[idx]?.name ?? detail.name
      return detail.builds.map((b) => ({ ...b, appName }))
    })
    .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))

  return { builds, isLoading }
}

export function useAppCaddyExtra(appId: string) {
  return useQuery<{ handlers: CaddyExtraHandlers | null }, ApiError>({
    queryKey: ["apps", appId, "caddy-extra"],
    queryFn: () =>
      apiFetch<{ handlers: CaddyExtraHandlers | null }>(
        `/apps/${appId}/caddy-extra`
      ),
    staleTime: 15_000,
    enabled: Boolean(appId),
  })
}

export function useUpdateAppCaddyExtra() {
  const qc = useQueryClient()
  return useMutation<
    { handlers: CaddyExtraHandlers | null },
    ApiError,
    { appId: string; handlers: CaddyExtraHandlers | null }
  >({
    mutationFn: ({ appId, handlers }) =>
      apiFetch<{ handlers: CaddyExtraHandlers | null }>(
        `/apps/${appId}/caddy-extra`,
        {
          method: "PATCH",
          body: { handlers },
          headers: { "content-type": "application/json" },
        }
      ),
    onSuccess: (data, { appId }) => {
      toast.success("Caddy handlers updated")
      qc.setQueryData(["apps", appId, "caddy-extra"], data)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}
