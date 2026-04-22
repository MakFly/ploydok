// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, criticalRetryDelay, invalidateGetCache, shouldRetryCriticalQuery } from "./api"
import { useEventsSubscription } from "./events-provider"
import type { AppConfig, AppStatus, Build, RestartPolicy } from "@ploydok/shared"
import type { ApiError } from "./api"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppListItem {
  id: string
  projectId?: string
  name: string
  slug: string
  status: AppStatus
  branch?: string
  domain?: string
  publicUrl?: string
  repoFullName?: string
  createdAt: number
  updatedAt: number
}

export interface AppDetail extends AppListItem {
  gitProvider?: string
  rootDir?: string
  dockerfilePath?: string
  installCommand?: string
  buildCommand?: string
  startCommand?: string
  buildMethod?: string
  restartPolicy?: RestartPolicy
  currentCommitSha?: string
  latestBuildId?: string
  healthcheckPath?: string
  healthcheckPort?: number | null
  // Healthcheck timing fields (W2.B fix — were silently dropped by normalizeAppDetail)
  healthcheckIntervalS?: number | null
  healthcheckTimeoutS?: number | null
  healthcheckRetries?: number | null
  healthcheckStartPeriodS?: number | null
  // Auto-deploy + webhook settings (sprint 3.1.1)
  autoDeployEnabled?: boolean
  postCommitStatus?: boolean
  coalescePushes?: boolean
  deployOnTag?: boolean
  tagPattern?: string | null
  webhookSecret?: boolean
  // Deploy hooks (Wave 5)
  hooksPreDeploy?: string | null
  hooksPostDeploy?: string | null
  hooksTimeoutS?: number | null
  // Last 10 builds included in GET /apps/:id response
  builds?: Array<Build>
}

interface AppsResponse {
  apps: Array<AppListItem>
}

interface BuildsResponse {
  builds: Array<Build>
}

// Backend serializes healthcheck as a nested object. Normalize to the flat
// shape used by the UI (forms, caches, components read `app.healthcheckPath`
// and `app.healthcheckPort` directly).
export interface RawAppDetail
  extends Omit<
    AppDetail,
    | "healthcheckPath"
    | "healthcheckPort"
    | "healthcheckIntervalS"
    | "healthcheckTimeoutS"
    | "healthcheckRetries"
    | "healthcheckStartPeriodS"
  > {
  healthcheck?: {
    path?: string | null
    port?: number | null
    intervalS?: number | null
    timeoutS?: number | null
    retries?: number | null
    startPeriodS?: number | null
  } | null
}

export function normalizeAppDetail(raw: RawAppDetail): AppDetail {
  const { healthcheck, ...rest } = raw
  return {
    ...rest,
    healthcheckPath: healthcheck?.path ?? undefined,
    healthcheckPort: healthcheck?.port ?? null,
    healthcheckIntervalS: healthcheck?.intervalS ?? null,
    healthcheckTimeoutS: healthcheck?.timeoutS ?? null,
    healthcheckRetries: healthcheck?.retries ?? null,
    healthcheckStartPeriodS: healthcheck?.startPeriodS ?? null,
  }
}

export type AppSettingsPatch = Partial<
  Pick<
    AppDetail,
    | "branch"
    | "rootDir"
    | "dockerfilePath"
    | "installCommand"
    | "buildCommand"
    | "startCommand"
    | "buildMethod"
    | "restartPolicy"
    | "healthcheckPath"
    | "healthcheckPort"
    | "autoDeployEnabled"
    | "postCommitStatus"
    | "coalescePushes"
    | "deployOnTag"
    | "tagPattern"
    | "hooksPreDeploy"
    | "hooksPostDeploy"
    | "hooksTimeoutS"
  >
>

interface AppStatusEventPayload {
  appId?: string
  data?: {
    status?: AppStatus
  }
}

export function applyAppStatus(
  app: AppDetail | AppListItem | undefined,
  status: AppStatus,
): AppDetail | AppListItem | undefined {
  if (!app) return app
  return { ...app, status }
}

export function getEventAppStatus(payload: AppStatusEventPayload): AppStatus | undefined {
  return payload.data?.status
}

// ---------------------------------------------------------------------------
// useApps
// ---------------------------------------------------------------------------

export function useApps() {
  return useQuery<Array<AppListItem>, ApiError>({
    queryKey: ["apps"],
    queryFn: async () => {
      const data = await apiFetch<AppsResponse>("/apps")
      return data.apps
    },
    staleTime: 30_000,
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    meta: { critical: true },
  })
}

// ---------------------------------------------------------------------------
// useCreateApp
// ---------------------------------------------------------------------------

export function useCreateApp() {
  const qc = useQueryClient()
  return useMutation<AppListItem, ApiError, Partial<AppConfig>>({
    mutationFn: (body) =>
      apiFetch<AppListItem>("/apps", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    onSuccess: () => {
      toast.success("App created")
      qc.invalidateQueries({ queryKey: ["apps"] })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

// ---------------------------------------------------------------------------
// useApp — single app detail
// ---------------------------------------------------------------------------

export interface UseAppOptions {
  /** Seed TanStack Query's cache with pre-fetched data (e.g. from a route loader). */
  initialData?: AppDetail
}

export function useApp(appId: string, opts?: UseAppOptions) {
  const qc = useQueryClient()

  const syncStatus = (status: AppStatus) => {
    qc.setQueryData<AppDetail | undefined>(["apps", appId], (current) =>
      applyAppStatus(current, status) as AppDetail | undefined,
    )
    qc.setQueryData<Array<AppListItem> | undefined>(["apps"], (current) =>
      current?.map((app) => (app.id === appId ? (applyAppStatus(app, status) as AppListItem) : app)),
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

  useEventsSubscription<AppStatusEventPayload>("deploy.status_change", (payload) => {
    if (payload.appId !== appId) return
    const status = getEventAppStatus(payload)
    if (status) syncStatus(status)
    refetchApp()
  })

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

// ---------------------------------------------------------------------------
// useBuilds — list builds for an app
// ---------------------------------------------------------------------------

export interface UseBuildsOptions {
  /** Seed TanStack Query's cache with pre-fetched data (e.g. from a route loader or GET /apps/:id). */
  initialData?: Array<Build>
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

// ---------------------------------------------------------------------------
// useRegistryUsage — per-app registry stats (tags, bytes, diskPct)
// ---------------------------------------------------------------------------

export interface RegistryUsage {
  tags: number
  bytes: number
  diskPct: number
}

export function useRegistryUsage(appId: string) {
  return useQuery<RegistryUsage, ApiError>({
    queryKey: ["apps", appId, "registry-usage"],
    queryFn: () => apiFetch<RegistryUsage>(`/apps/${appId}/registry-usage`),
    staleTime: 30_000,
    enabled: Boolean(appId),
  })
}

// ---------------------------------------------------------------------------
// useRecentBuildsAcrossApps — merge builds from the last N apps
// ---------------------------------------------------------------------------

export interface BuildWithApp extends Build {
  appName: string
}

/**
 * Fetch app details (which include the last 10 builds) for each of the first
 * `maxApps` apps, then merge and sort all builds by createdAt desc.
 *
 * This avoids needing a dedicated /builds global endpoint (not yet implemented).
 */
export function useRecentBuildsAcrossApps(
  apps: Array<AppListItem>,
  maxApps = 6,
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
