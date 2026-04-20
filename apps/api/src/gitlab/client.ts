// SPDX-License-Identifier: AGPL-3.0-only
import { GitBranchSchema, GitRepoSchema } from "@ploydok/shared";
import type { GitBranch, GitProvider, GitRepo } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// GitLabProvider
//
// GitLab uses per-user OAuth2 Bearer tokens (not installation tokens).
// The caller (routes/gitlab.ts) decrypts the stored access token and passes
// it as `token` to every provider call.
// ---------------------------------------------------------------------------

export class GitLabProvider implements GitProvider {
  kind = "gitlab" as const;

  constructor(private instanceUrl: string) {}

  private get apiBase(): string {
    return `${this.instanceUrl.replace(/\/+$/, "")}/api/v4`;
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "User-Agent": "ploydok",
    };
  }

  async listRepos(
    token: string,
    opts: { page?: number; perPage?: number; search?: string } = {},
  ): Promise<{ repos: GitRepo[]; hasMore: boolean }> {
    const page = opts.page ?? 1;
    const perPage = opts.perPage ?? 30;
    const params = new URLSearchParams({
      membership: "true",
      simple: "true",
      order_by: "last_activity_at",
      per_page: String(perPage),
      page: String(page),
    });
    if (opts.search) params.set("search", opts.search);

    const url = `${this.apiBase}/projects?${params.toString()}`;
    const res = await fetch(url, { headers: this.headers(token) });
    if (res.status !== 200) {
      throw new Error(`GitLab /projects returned ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>[];
    const repos = body.map(mapGitLabRepo);
    // GitLab returns X-Next-Page header; empty means no more pages.
    const next = res.headers.get("x-next-page");
    const hasMore = next !== null && next !== "";
    return { repos, hasMore };
  }

  async getRepo(token: string, fullName: string): Promise<GitRepo> {
    const encoded = encodeURIComponent(fullName);
    const res = await fetch(`${this.apiBase}/projects/${encoded}`, {
      headers: this.headers(token),
    });
    if (res.status === 404) throw new Error(`Repository not found: ${fullName}`);
    if (res.status !== 200) throw new Error(`GitLab /projects/${fullName} returned ${res.status}`);
    return mapGitLabRepo((await res.json()) as Record<string, unknown>);
  }

  async listBranches(token: string, fullName: string): Promise<GitBranch[]> {
    const encoded = encodeURIComponent(fullName);
    const res = await fetch(
      `${this.apiBase}/projects/${encoded}/repository/branches?per_page=100`,
      { headers: this.headers(token) },
    );
    if (res.status !== 200) {
      throw new Error(`GitLab /projects/${fullName}/repository/branches returned ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>[];
    return body.map(mapGitLabBranch);
  }

  /** Build a clone URL embedding the OAuth token (for `git clone`). */
  cloneUrlWithToken(fullName: string, token: string): string {
    const host = new URL(this.instanceUrl).host;
    return `https://oauth2:${token}@${host}/${fullName}.git`;
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapGitLabRepo(raw: Record<string, unknown>): GitRepo {
  return GitRepoSchema.parse({
    id: raw["id"],
    // GitLab `path_with_namespace` is the `group/project` identifier equivalent
    // to GitHub's `full_name`.
    fullName: raw["path_with_namespace"],
    description: (raw["description"] as string | null | undefined) ?? null,
    private: (raw["visibility"] as string | undefined) !== "public",
    defaultBranch: (raw["default_branch"] as string | undefined) ?? "main",
    cloneUrl: (raw["http_url_to_repo"] as string | undefined) ?? "",
  });
}

function mapGitLabBranch(raw: Record<string, unknown>): GitBranch {
  const commit = raw["commit"] as Record<string, unknown> | undefined;
  return GitBranchSchema.parse({
    name: raw["name"],
    commitSha: (commit?.["id"] as string | undefined) ?? "",
  });
}
