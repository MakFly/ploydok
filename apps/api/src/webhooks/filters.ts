// SPDX-License-Identifier: AGPL-3.0-only
import type { InferSelectModel } from "drizzle-orm"
import type { apps } from "@ploydok/db"
import { childLogger } from "../logger"

const log = childLogger("webhook.filters")

type App = Pick<
  InferSelectModel<typeof apps>,
  "auto_deploy_enabled" | "branch" | "watch_paths" | "coalesce_pushes"
>

export type DecisionEnum =
  | "enqueued"
  | "skipped_disabled"
  | "skipped_branch"
  | "skipped_path"
  | "skipped_directive"
  | "skipped_unknown_app"
  | "skipped_tag_disabled"
  | "skipped_tag_pattern"
  | "invalid_signature"
  | "error"
  | "coalesced"
  | "retried"

export type Decision = { decision: DecisionEnum; reason: string }

const SKIP_DIRECTIVES = /\[skip\s+(?:deploy|ci)\]|\[no\s+deploy\]/i

/**
 * Returns true if the commit message contains a skip directive.
 * Patterns (case-insensitive): [skip deploy], [skip ci], [no deploy]
 */
export function hasSkipDirective(commitMessage: string): boolean {
  return SKIP_DIRECTIVES.test(commitMessage)
}

/**
 * Returns true if at least one changed path matches a watch glob pattern.
 * watch_paths is a JSON array of glob strings (e.g. ["apps/web/**", "packages/**"]).
 * An empty or null watch_paths list means "watch everything" → always matches.
 */
export function matchesWatchPaths(
  changedFiles: string[],
  watchPathsJson: string | null | undefined,
): boolean {
  if (!watchPathsJson) return true

  let patterns: string[]
  try {
    patterns = JSON.parse(watchPathsJson) as string[]
  } catch {
    return true
  }

  if (!Array.isArray(patterns) || patterns.length === 0) return true

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for (const file of changedFiles) {
      if (glob.match(file)) return true
    }
  }
  return false
}

/**
 * Runs the full filter chain for a push event against a single app.
 * Order: auto_deploy → branch → watch_paths → skip directive
 */
export function filterPushEvent(
  app: App,
  event: { branch: string; commitMessage: string; changedFiles?: string[] },
): Decision {
  if (!app.auto_deploy_enabled) {
    return { decision: "skipped_disabled", reason: "auto_deploy_enabled=false" }
  }

  if (app.branch && app.branch !== event.branch) {
    return {
      decision: "skipped_branch",
      reason: `app branch="${app.branch}" does not match push branch="${event.branch}"`,
    }
  }

  if (
    event.changedFiles !== undefined &&
    event.changedFiles.length > 0 &&
    !matchesWatchPaths(event.changedFiles, app.watch_paths)
  ) {
    return {
      decision: "skipped_path",
      reason: "no changed file matched watch_paths",
    }
  }

  if (hasSkipDirective(event.commitMessage)) {
    return {
      decision: "skipped_directive",
      reason: "commit message contains skip directive",
    }
  }

  return { decision: "enqueued", reason: "all filters passed" }
}

/**
 * Returns true if tagName matches the given regex pattern.
 * null pattern means "accept all tags".
 * Invalid regex (DB corruption) → logs warn + returns false (no-match).
 */
export function matchesTagPattern(tagName: string, pattern: string | null): boolean {
  if (pattern === null) return true
  try {
    return new RegExp(pattern).test(tagName)
  } catch (err) {
    log.warn({ err, pattern }, "invalid tag_pattern in DB — treating as no-match")
    return false
  }
}
