// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ApiError } from "./api";
import type { AppConfig, AppStatus, Build } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppListItem {
  id: string;
  name: string;
  slug: string;
  status: AppStatus;
  branch?: string;
  domain?: string;
  repoFullName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppDetail extends AppListItem {
  gitProvider?: string;
  rootDir?: string;
  dockerfilePath?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  buildMethod?: string;
  currentCommitSha?: string;
  latestBuildId?: string;
  healthcheckPath?: string;
}

interface AppsResponse {
  apps: Array<AppListItem>;
}

interface BuildsResponse {
  builds: Array<Build>;
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
  >
>;

// ---------------------------------------------------------------------------
// useApps
// ---------------------------------------------------------------------------

export function useApps() {
  return useQuery<Array<AppListItem>, ApiError>({
    queryKey: ["apps"],
    queryFn: async () => {
      const data = await apiFetch<AppsResponse>("/apps");
      return data.apps;
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useCreateApp
// ---------------------------------------------------------------------------

export function useCreateApp() {
  const qc = useQueryClient();
  return useMutation<AppListItem, ApiError, Partial<AppConfig>>({
    mutationFn: (body) =>
      apiFetch<AppListItem>("/apps", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useApp — single app detail
// ---------------------------------------------------------------------------

export function useApp(appId: string) {
  return useQuery<AppDetail, ApiError>({
    queryKey: ["apps", appId],
    queryFn: async () => {
      const { app } = await apiFetch<{ app: AppDetail; builds: Array<unknown> }>(
        `/apps/${appId}`,
      );
      return app;
    },
    staleTime: 15_000,
    enabled: Boolean(appId),
  });
}

// ---------------------------------------------------------------------------
// useBuilds — list builds for an app
// ---------------------------------------------------------------------------

export function useBuilds(appId: string) {
  return useQuery<Array<Build>, ApiError>({
    queryKey: ["apps", appId, "builds"],
    queryFn: async () => {
      const data = await apiFetch<BuildsResponse>(`/apps/${appId}/builds`);
      return data.builds;
    },
    staleTime: 10_000,
    enabled: Boolean(appId),
  });
}

// ---------------------------------------------------------------------------
// useDeployApp
// ---------------------------------------------------------------------------

export function useDeployApp(appId: string) {
  const qc = useQueryClient();
  return useMutation<{ jobId: string }, ApiError, void>({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/apps/${appId}/deploy`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useRollbackApp
// ---------------------------------------------------------------------------

export function useRollbackApp(appId: string) {
  const qc = useQueryClient();
  return useMutation<{ jobId: string }, ApiError, { buildId: string }>({
    mutationFn: ({ buildId }) =>
      apiFetch<{ jobId: string }>(`/apps/${appId}/rollback`, {
        method: "POST",
        body: { buildId },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
      void qc.invalidateQueries({ queryKey: ["apps", appId, "builds"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useStopApp / useRestartApp
// ---------------------------------------------------------------------------

export function useStopApp(appId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}/stop`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function useRestartApp(appId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiFetch<void>(`/apps/${appId}/restart`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

// ---------------------------------------------------------------------------
// useRecentBuildsAcrossApps — merge builds from the last N apps
// ---------------------------------------------------------------------------

export interface BuildWithApp extends Build {
  appName: string;
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
  const targets = apps.slice(0, maxApps);

  const results = useQueries({
    queries: targets.map((app) => ({
      queryKey: ["apps", app.id],
      queryFn: async () => {
        const data = await apiFetch<{ app: AppDetail; builds: Array<Build> }>(`/apps/${app.id}`);
        return { app: data.app, builds: data.builds, appName: app.name };
      },
      staleTime: 15_000,
      enabled: Boolean(app.id),
    })),
  });

  const isLoading = results.some((r) => r.isLoading);

  const builds: Array<BuildWithApp> = results
    .flatMap((r) => {
      if (!r.data?.builds) return [];
      const { appName, builds: buildList } = r.data;
      return buildList.map((b) => ({ ...b, appName }));
    })
    .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt));

  return { builds, isLoading };
}

// ---------------------------------------------------------------------------
// useUpdateAppSettings
// ---------------------------------------------------------------------------

export function useUpdateAppSettings(appId: string) {
  const qc = useQueryClient();
  return useMutation<AppDetail, ApiError, AppSettingsPatch>({
    mutationFn: async (body) => {
      const { app } = await apiFetch<{ app: AppDetail; builds: Array<unknown> }>(
        `/apps/${appId}`,
        { method: "PATCH", body },
      );
      return app;
    },
    onSuccess: (updated) => {
      qc.setQueryData(["apps", appId], updated);
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
