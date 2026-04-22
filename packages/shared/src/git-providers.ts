// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// ---------------------------------------------------------------------------
// Git provider kinds
// ---------------------------------------------------------------------------

// 'image' is a virtual provider for Docker-image deploys (no clone/build).
// TODO(bitbucket): add 'bitbucket' once the adapter lands.
export type GitProviderKind = 'github' | 'gitlab' | 'image';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const GitRepoSchema = z.object({
  id: z.union([z.number(), z.string()]),
  fullName: z.string(),        // 'owner/repo'
  description: z.string().nullable(),
  private: z.boolean(),
  defaultBranch: z.string(),
  cloneUrl: z.string().url(), // https URL (sans token)
});
export type GitRepo = z.infer<typeof GitRepoSchema>;

export const GitBranchSchema = z.object({
  name: z.string(),
  commitSha: z.string(),
});
export type GitBranch = z.infer<typeof GitBranchSchema>;

// ---------------------------------------------------------------------------
// GitProvider interface
// ---------------------------------------------------------------------------

export interface WebhookVerifyInput {
  /** Raw HTTP body exactly as received (not re-serialized). */
  rawBody: string;
  /** Lower-cased header map for provider-agnostic access. */
  headers: Record<string, string>;
  /** Shared secret configured on the app side. */
  secret: string;
}

export interface CommitStatusInput {
  owner: string
  repo: string
  sha: string
  state: "pending" | "success" | "failure" | "error"
  context: string
  targetUrl?: string
  description?: string
  token: string
}

export interface GitProvider {
  kind: GitProviderKind;
  listRepos(
    token: string,
    opts?: { page?: number; perPage?: number; search?: string },
  ): Promise<{ repos: GitRepo[]; hasMore: boolean }>;
  getRepo(token: string, fullName: string): Promise<GitRepo>;
  listBranches(token: string, fullName: string): Promise<GitBranch[]>;
  /** Build a clone URL embedding the token (for `git clone`). */
  cloneUrlWithToken(fullName: string, token: string): string;
  /** Constant-time signature/token verification for incoming webhooks. */
  verifyWebhookSignature(input: WebhookVerifyInput): boolean;
  /**
   * Parse a verified webhook into the provider-agnostic push shape.
   * Returns null for non-push events (pings, installation lifecycle, PRs, …).
   */
  parseWebhookPushEvent(
    event: string,
    payload: unknown,
  ): ParsedPushEvent | null;
  /** Post a commit status (check) to the provider. */
  postCommitStatus(input: CommitStatusInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Webhook parsing — shared contract for provider-agnostic push handler
// ---------------------------------------------------------------------------

export const ParsedPushEventSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  repoFullName: z.string(),
  /** Raw git ref (e.g. refs/heads/main, refs/tags/v1.0.0). */
  ref: z.string().optional(),
  branch: z.string(),
  commitSha: z.string(),
  commitMessage: z.string(),
  /** Provider-specific authentication token reference (installation id for GitHub, user id for GitLab). */
  authRef: z.string(),
});
export type ParsedPushEvent = z.infer<typeof ParsedPushEventSchema>;
