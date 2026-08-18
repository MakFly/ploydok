// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import type { CommitStatusInput } from "@ploydok/shared"
import { getInstallationToken } from "../github/installation-tokens"
import { resolveGitLabConnection } from "../gitlab/connection"
import { childLogger } from "../logger"
import { env } from "../env"
import { getProvider } from "./index"
import type { Redis } from "@ploydok/db"

const log = childLogger("commit-status")

const CONTEXT = "ploydok/build"

export interface AppForCommitStatus {
  id: string
  git_provider: string | null
  repo_full_name: string | null
  github_installation_id: string | null
  gitlab_credential_user_id?: string | null
  owner_id: string
  post_commit_status: boolean
}

export interface PostCommitStatusOptions {
  sha: string
  state: CommitStatusInput["state"]
  description?: string
  buildId?: string
  buildNumber?: number
  durationMs?: number
  /** Re-check deploy ownership immediately before provider network calls. */
  beforeSend?: () => Promise<void>
}

/**
 * Post a commit status to GitHub or GitLab for the given app.
 * Failures are caught and logged — never thrown — so the deploy pipeline
 * is never broken by a commit status failure.
 */
export async function postCommitStatusForApp(
  db: Db,
  redis: Redis,
  app: AppForCommitStatus,
  opts: PostCommitStatusOptions
): Promise<void> {
  if (!app.post_commit_status) return
  if (!app.repo_full_name) return

  const provider = app.git_provider
  if (provider !== "github" && provider !== "gitlab") return

  const { sha, state, buildId } = opts

  // Dedup: skip if we already sent the exact same state for this sha+context in the last 60s
  await opts.beforeSend?.()
  const dedupKey = `status:sent:${sha}:${CONTEXT}:${state}`
  const isNew = await redis.set(dedupKey, "1", "EX", 60, "NX").catch(() => null)
  if (isNew === null) {
    log.debug({ sha, state, appId: app.id }, "commit status dedup — skip")
    return
  }

  const pathParts = app.repo_full_name.split("/").filter(Boolean)
  const repo = pathParts.pop()
  const owner = pathParts.join("/")
  if (!owner || !repo) return

  const targetUrl = buildId
    ? `${env.WEB_ORIGIN}/apps/${app.id}/deployments`
    : undefined

  let description = opts.description
  if (!description && opts.buildNumber != null) {
    if (opts.durationMs != null) {
      const secs = Math.round(opts.durationMs / 1000)
      description = `Build #${opts.buildNumber} — ${secs}s`
    } else {
      description = `Build #${opts.buildNumber}`
    }
  }

  const statusInput: Omit<CommitStatusInput, "token" | "context"> = {
    owner,
    repo,
    sha,
    state,
    ...(targetUrl !== undefined && { targetUrl }),
    ...(description !== undefined && { description }),
  }

  await opts.beforeSend?.()
  try {
    if (provider === "github") {
      await postGitHubStatus(app, statusInput)
    } else {
      await postGitLabStatus(db, app, statusInput)
    }
    log.info({ sha, state, provider, appId: app.id }, "commit status posted")
  } catch (err) {
    log.warn(
      { err, sha, state, provider, appId: app.id },
      "commit status post failed (non-fatal)"
    )
  }
}

async function postGitHubStatus(
  app: AppForCommitStatus,
  input: Omit<CommitStatusInput, "token" | "context">
): Promise<void> {
  if (!app.github_installation_id) {
    log.debug(
      { appId: app.id },
      "no github_installation_id — skip commit status"
    )
    return
  }
  const token = await getInstallationToken(app.github_installation_id)
  const ghProvider = getProvider("github")
  await ghProvider.postCommitStatus({ ...input, context: CONTEXT, token })
}

async function postGitLabStatus(
  db: Db,
  app: AppForCommitStatus,
  input: Omit<CommitStatusInput, "token" | "context">
): Promise<void> {
  if (!app.gitlab_credential_user_id) {
    log.debug(
      { appId: app.id },
      "no exact GitLab credential — skip commit status"
    )
    return
  }
  const connection = await resolveGitLabConnection(
    db,
    app.gitlab_credential_user_id
  )
  await connection.provider.postCommitStatus({
    ...input,
    context: CONTEXT,
    token: connection.accessToken,
  })
}
