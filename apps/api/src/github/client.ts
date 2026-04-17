// SPDX-License-Identifier: AGPL-3.0-only
import { GitBranchSchema, GitRepoSchema } from "@ploydok/shared";
import type { GitBranch, GitProvider, GitRepo } from "@ploydok/shared";
import type { GitHubCache } from "./cache";
import { getInstallationToken } from "./installation-tokens";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GH_API = "https://api.github.com";
const GH_ACCEPT = "application/vnd.github+json";
const GH_API_VERSION = "2022-11-28";
const USER_AGENT = "ploydok";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GH_ACCEPT,
    "X-GitHub-Api-Version": GH_API_VERSION,
    "User-Agent": USER_AGENT,
  };
}

/**
 * Map a raw GitHub API repo object to a `GitRepo`.
 */
function mapRepo(raw: Record<string, unknown>): GitRepo {
  return GitRepoSchema.parse({
    id: raw["id"],
    fullName: raw["full_name"],
    description: raw["description"] ?? null,
    private: raw["private"],
    defaultBranch: raw["default_branch"],
    cloneUrl: raw["clone_url"],
  });
}

/**
 * Map a raw GitHub branch object to a `GitBranch`.
 */
function mapBranch(raw: Record<string, unknown>): GitBranch {
  const commit = raw["commit"] as Record<string, unknown> | undefined;
  return GitBranchSchema.parse({
    name: raw["name"],
    commitSha: commit?.["sha"] ?? "",
  });
}

// ---------------------------------------------------------------------------
// Installation-token based fetcher
// ---------------------------------------------------------------------------

/**
 * Perform a GitHub API GET using an installation access token.
 * The token is obtained (and cached) via `getInstallationToken`.
 */
export async function fetchGitHub(
  installationId: string,
  path: string,
  cache?: GitHubCache,
): Promise<{ status: number; data: unknown }> {
  const token = await getInstallationToken(installationId);
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;

  if (cache) {
    return cache.fetch(url, { headers: ghHeaders(token) });
  }

  const res = await fetch(url, { headers: ghHeaders(token) });
  const data = await res.json();
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// GitHubProvider
// ---------------------------------------------------------------------------

export class GitHubProvider implements GitProvider {
  kind = "github" as const;

  constructor(private cache: GitHubCache) {}

  /**
   * List repos accessible to the given installation.
   * Uses /installation/repositories which returns repos the App is installed on.
   */
  async listRepos(
    installationId: string,
    opts: { page?: number; perPage?: number; search?: string } = {},
  ): Promise<{ repos: GitRepo[]; hasMore: boolean }> {
    const page = opts.page ?? 1;
    const perPage = opts.perPage ?? 30;
    const path = `/installation/repositories?sort=updated&page=${page}&per_page=${perPage}`;

    const { status, data } = await fetchGitHub(installationId, path, this.cache);

    if (status !== 200) {
      throw new Error(`GitHub /installation/repositories returned ${status}`);
    }

    const body = data as { repositories: Record<string, unknown>[] };
    let repos = (body.repositories ?? []).map(mapRepo);

    if (opts.search) {
      const q = opts.search.toLowerCase();
      repos = repos.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q) ?? false),
      );
    }

    const rawCount = (body.repositories ?? []).length;
    const hasMore = rawCount >= perPage;

    return { repos, hasMore };
  }

  async getRepo(installationId: string, fullName: string): Promise<GitRepo> {
    const { status, data } = await fetchGitHub(
      installationId,
      `/repos/${fullName}`,
      this.cache,
    );

    if (status === 404) {
      throw new Error(`Repository not found: ${fullName}`);
    }
    if (status !== 200) {
      throw new Error(`GitHub /repos/${fullName} returned ${status}`);
    }

    return mapRepo(data as Record<string, unknown>);
  }

  async listBranches(installationId: string, fullName: string): Promise<GitBranch[]> {
    const { status, data } = await fetchGitHub(
      installationId,
      `/repos/${fullName}/branches?per_page=100`,
      this.cache,
    );

    if (status !== 200) {
      throw new Error(`GitHub /repos/${fullName}/branches returned ${status}`);
    }

    return (data as Record<string, unknown>[]).map(mapBranch);
  }

  cloneUrlWithToken(fullName: string, token: string): string {
    return `https://x-access-token:${token}@github.com/${fullName}.git`;
  }
}
