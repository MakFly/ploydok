// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, invalidateGetCache } from "./api"
import { useEventsSubscription } from "./events-provider"
import type { AppConfig, AppStatus, Build } from "@ploydok/shared"
import type { ApiError } from "./api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppListItem {
  id: string
  name: string
  slug: string
  status: AppStatus
  branch?: string
  domain?: string
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
  currentCommitSha?: string
  latestBuildId?: string
  healthcheckPath?: string
  healthcheckPort?: number | null
  // Healthcheck timing fields (W2.B fix — were silently dropped by normalizeAppDetail)
  healthcheckIntervalS?: number | null
  healthcheckTimeoutS?: number | null
  healthcheckRetries?: number | null
  healthcheckStartPeriodS?: number | null
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
    | "healthcheckPath"
    | "healthcheckPort"
  >
>

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
      qc.invalidateQueries({ queryKey: ["apps"] })
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
      queryFn: async () => {
        const data = await apiFetch<{ app: RawAppDetail; builds: Array<Build> }>(`/apps/${app.id}`)
        return { app: normalizeAppDetail(data.app), builds: data.builds, appName: app.name }
      },
      staleTime: 15_000,
      enabled: Boolean(app.id),
    })),
  })

  const isLoading = results.some((r) => r.isLoading)

  const builds: Array<BuildWithApp> = results
    .flatMap((r) => {
      if (!r.data?.builds) return []
      const { appName, builds: buildList } = r.data
      return buildList.map((b) => ({ ...b, appName }))
    })
    .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))

  return { builds, isLoading }
}
