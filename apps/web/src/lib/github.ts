// SPDX-License-Identifier: AGPL-3.0-only
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, criticalRetryDelay, shouldRetryCriticalQuery } from "./api";
import type { ApiError } from "./api";
import type { GitBranch, GitRepo } from "@ploydok/shared";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubAppConfig {
  configured: boolean;
  name?: string;
  slug?: string;
  app_id?: string;
  install_url?: string;
}

export interface CreateGitHubAppResponse {
  manifest: Record<string, unknown>;
  state: string;
  post_url: string;
}

export interface AppInstallation {
  id: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
  htmlUrl: string;
  avatarUrl: string;
  repositoryCount: number | null;
}

export interface InstallationsResponse {
  installations: Array<AppInstallation>;
  installUrl: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReposPage {
  repos: Array<GitRepo>;
  hasMore: boolean;
}

interface ReposParams {
  search?: string;
  perPage?: number;
}

// ---------------------------------------------------------------------------
// useGitHubRepos — infinite query (installation-token based)
// ---------------------------------------------------------------------------

export function useGitHubRepos(params: ReposParams = {}) {
  const { search, perPage = 30 } = params;

  return useInfiniteQuery<ReposPage, ApiError>({
    queryKey: ["github", "repos", search ?? ""],
    queryFn: ({ pageParam }) => {
      const page = (pageParam as number | undefined) ?? 1;
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
      return apiFetch<ReposPage>(
        `/github/repos?page=${page}&per_page=${perPage}${searchParam}`,
      );
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    initialPageParam: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
  });
}

// ---------------------------------------------------------------------------
// useGitHubBranches
// ---------------------------------------------------------------------------

export function useGitHubBranches(fullName?: string) {
  return useQuery<Array<GitBranch>, ApiError>({
    queryKey: ["github", "branches", fullName ?? ""],
    queryFn: async () => {
      if (!fullName) return [];
      const [owner, repo] = fullName.split("/");
      const res = await apiFetch<{ branches: Array<GitBranch> }>(
        `/github/repos/${owner}/${repo}/branches`,
      );
      return res.branches;
    },
    enabled: Boolean(fullName),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useGitHubFileExists — detect presence of a file on a given branch
// ---------------------------------------------------------------------------

export function useGitHubFileExists(
  fullName: string | undefined,
  filePath: string,
  ref: string | undefined,
) {
  return useQuery<boolean, ApiError>({
    queryKey: ["github", "file-exists", fullName ?? "", filePath, ref ?? ""],
    queryFn: async () => {
      if (!fullName || !ref) return false
      const [owner, repo] = fullName.split("/")
      const res = await apiFetch<{ exists: boolean }>(
        `/github/repos/${owner}/${repo}/file-exists?path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(ref)}`,
      )
      return res.exists
    },
    enabled: Boolean(fullName && ref),
    staleTime: 5 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// useGitHubAppConfig — fetch singleton GitHub App config
// ---------------------------------------------------------------------------

export function useGitHubAppConfig() {
  return useQuery<GitHubAppConfig, ApiError>({
    queryKey: ["github", "app", "config"],
    queryFn: () => apiFetch<GitHubAppConfig>("/github/app/config"),
    staleTime: 60_000,
    retry: shouldRetryCriticalQuery,
    retryDelay: criticalRetryDelay,
    meta: { critical: true },
  });
}

// ---------------------------------------------------------------------------
// useCreateGitHubApp — POST /github/app/manifest, then auto-submit form to GitHub
// ---------------------------------------------------------------------------

export function useCreateGitHubApp() {
  return useMutation<CreateGitHubAppResponse, ApiError, void>({
    mutationFn: () =>
      apiFetch<CreateGitHubAppResponse>("/github/app/manifest", { method: "POST" }),
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

// ---------------------------------------------------------------------------
// useResetGitHubApp — DELETE /github/app/config
// ---------------------------------------------------------------------------

export function useResetGitHubApp() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => apiFetch<void>("/github/app/config", { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData(["github", "app", "config"], {
        configured: false,
      } satisfies GitHubAppConfig);
      qc.invalidateQueries({ queryKey: ["github", "app"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useInstallations — GET /github/installations
// ---------------------------------------------------------------------------

export function useInstallations() {
  return useQuery<InstallationsResponse, ApiError>({
    queryKey: ["github", "installations"],
    queryFn: () => apiFetch<InstallationsResponse>("/github/installations"),
    // Short stale so returning from GitHub install flow refreshes immediately.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: (failureCount, error) => {
      if (error.status === 401 || error.status === 503) return false;
      return failureCount < 2;
    },
  });
}

// ---------------------------------------------------------------------------
// useRevokeInstallation — DELETE /github/installations/:id
// ---------------------------------------------------------------------------

export function useRevokeInstallation() {
  const qc = useQueryClient();
  return useMutation<{ ok: true; revoked: number }, ApiError, number>({
    mutationFn: (installationId) =>
      apiFetch<{ ok: true; revoked: number }>(`/github/installations/${installationId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "installations"] });
      qc.invalidateQueries({ queryKey: ["github", "repos"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Cache status — exposes per-installation freshness + repo count from DB.
// ---------------------------------------------------------------------------

export interface CacheStatusEntry {
  id: string;
  externalId: string;
  accountLogin: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
  lastSyncedAt: string;
  repoCount: number;
  ageMs: number;
  status: "fresh" | "stale";
}

export interface CacheStatusResponse {
  installations: Array<CacheStatusEntry>;
  staleThresholdMs: number;
}

export function useGitHubCacheStatus(opts: { autoRefresh?: boolean } = {}) {
  return useQuery<CacheStatusResponse, ApiError>({
    queryKey: ["github", "cache-status"],
    queryFn: () => apiFetch<CacheStatusResponse>("/github/installations/cache-status"),
    staleTime: 5_000,
    refetchInterval: opts.autoRefresh ? 3_000 : false,
  });
}

export function useSyncGitHubInstallations() {
  const qc = useQueryClient();
  return useMutation<{ enqueued: true }, ApiError, { installationId?: string } | void>({
    mutationFn: (vars) =>
      apiFetch<{ enqueued: true }>("/github/installations/sync", {
        method: "POST",
        body: JSON.stringify(vars ?? {}),
        headers: { "content-type": "application/json" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "cache-status"] });
      qc.invalidateQueries({ queryKey: ["github", "repos"] });
    },
  });
}
