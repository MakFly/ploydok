// SPDX-License-Identifier: AGPL-3.0-only
import { GitBranchSchema, GitRepoSchema } from "@ploydok/shared";
import type {
  CommitStatusInput,
  GitBranch,
  GitProvider,
  GitRepo,
  ParsedPushEvent,
  WebhookVerifyInput,
} from "@ploydok/shared";
import { verifyGitLabToken, type GitLabPushPayload } from "./webhook";

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

  verifyWebhookSignature(input: WebhookVerifyInput): boolean {
    return verifyGitLabToken(input.headers["x-gitlab-token"] ?? null, input.secret);
  }

  parseWebhookPushEvent(event: string, payload: unknown): ParsedPushEvent | null {
    if (event !== "Push Hook") return null;
    const push = payload as GitLabPushPayload;
    if (push.object_kind !== "push") return null;
    return {
      provider: "gitlab",
      repoFullName: push.project.path_with_namespace,
      branch: push.ref.replace(/^refs\/heads\//, ""),
      commitSha: push.checkout_sha,
      commitMessage: push.commits?.[0]?.message ?? "",
      authRef: String(push.user_id),
    };
  }

  async postCommitStatus(input: CommitStatusInput): Promise<void> {
    const { owner, repo, sha, state, context, targetUrl, description, token } = input;
    // GitLab uses path_with_namespace as project identifier
    const fullName = `${owner}/${repo}`;
    const encoded = encodeURIComponent(fullName);

    // Map generic states to GitLab-specific states
    const gitlabState =
      state === "pending" ? "pending"
      : state === "success" ? "success"
      : "failed";

    const params = new URLSearchParams({ state: gitlabState, name: context });
    if (targetUrl) params.set("target_url", targetUrl);
    if (description) params.set("description", description);

    const url = `${this.apiBase}/projects/${encoded}/statuses/${sha}?${params.toString()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(token),
    });

    if (!res.ok) {
      throw new Error(`GitLab commit status POST returned ${res.status} for ${sha}`);
    }
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
