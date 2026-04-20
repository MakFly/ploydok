// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Git provider registry.
 *
 * Centralises the `GitProvider` implementations so callers can go from a
 * `kind` string (as stored in `apps.git_provider`) to a working adapter
 * without importing each file individually.
 *
 * Use-cases:
 *   - Webhook routes: pick the right verifier/parser from the event source.
 *   - Clone step in the deploy worker: build a clone URL without knowing
 *     which provider the app belongs to.
 *   - Future sprints (3.1.1): provider-agnostic audit pipeline.
 *
 * This registry keeps each adapter lazily resolved so we don't pay the cost
 * of instantiating GitHub (requires cache) or GitLab (requires instance URL)
 * when the caller only needs the other one.
 */
import type { GitProvider, GitProviderKind } from "@ploydok/shared";
import { GitHubProvider } from "../github/client";
import { GitLabProvider } from "../gitlab/client";
import { GitHubCache } from "../github/cache";

export type SupportedGitKind = Extract<GitProviderKind, "github" | "gitlab">;

export interface ProviderContext {
  /** GitLab instance URL (e.g. https://gitlab.com). Required only for GitLab. */
  gitlabInstanceUrl?: string;
}

const githubSingleton = new GitHubProvider(new GitHubCache());

export function getProvider(
  kind: SupportedGitKind,
  ctx: ProviderContext = {},
): GitProvider {
  switch (kind) {
    case "github":
      return githubSingleton;
    case "gitlab": {
      const url = ctx.gitlabInstanceUrl ?? "https://gitlab.com";
      return new GitLabProvider(url);
    }
  }
}

/**
 * Infer a provider kind from the webhook event header names.
 * Returns null for unknown sources so the caller can 400-reject.
 */
export function detectProviderFromHeaders(
  headers: Record<string, string>,
): SupportedGitKind | null {
  if (headers["x-github-event"]) return "github";
  if (headers["x-gitlab-event"]) return "gitlab";
  return null;
}
