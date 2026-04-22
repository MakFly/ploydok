// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import {
  getGitLabConfig,
  getGitLabTokens,
} from "@ploydok/db/queries"
import type { CommitStatusInput } from "@ploydok/shared"
import { decryptField } from "../github/app-credentials"
import { getInstallationToken } from "../github/installation-tokens"
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
  opts: PostCommitStatusOptions,
): Promise<void> {
  if (!app.post_commit_status) return
  if (!app.repo_full_name) return

  const provider = app.git_provider
  if (provider !== "github" && provider !== "gitlab") return

  const { sha, state, buildId } = opts

  // Dedup: skip if we already sent the exact same state for this sha+context in the last 60s
  const dedupKey = `status:sent:${sha}:${CONTEXT}:${state}`
  const isNew = await redis.set(dedupKey, "1", "EX", 60, "NX").catch(() => null)
  if (isNew === null) {
    log.debug({ sha, state, appId: app.id }, "commit status dedup — skip")
    return
  }

  const [owner, repo] = app.repo_full_name.split("/")
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

  try {
    if (provider === "github") {
      await postGitHubStatus(app, statusInput)
    } else {
      await postGitLabStatus(db, app, statusInput)
    }
    log.info({ sha, state, provider, appId: app.id }, "commit status posted")
  } catch (err) {
    log.warn({ err, sha, state, provider, appId: app.id }, "commit status post failed (non-fatal)")
  }
}

async function postGitHubStatus(
  app: AppForCommitStatus,
  input: Omit<CommitStatusInput, "token" | "context">,
): Promise<void> {
  if (!app.github_installation_id) {
    log.debug({ appId: app.id }, "no github_installation_id — skip commit status")
    return
  }
  const token = await getInstallationToken(app.github_installation_id)
  const ghProvider = getProvider("github")
  await ghProvider.postCommitStatus({ ...input, context: CONTEXT, token })
}

async function postGitLabStatus(
  db: Db,
  app: AppForCommitStatus,
  input: Omit<CommitStatusInput, "token" | "context">,
): Promise<void> {
  const cfg = await getGitLabConfig(db)
  if (!cfg) {
    log.debug({ appId: app.id }, "gitlab not configured — skip commit status")
    return
  }
  const tokens = await getGitLabTokens(db, app.owner_id)
  if (!tokens) {
    log.debug({ appId: app.id }, "no gitlab tokens for owner — skip commit status")
    return
  }
  const accessToken = await decryptField(
    tokens.access_token_enc as Buffer,
    tokens.access_token_nonce as Buffer,
  )
  const glProvider = getProvider("gitlab", { gitlabInstanceUrl: cfg.instance_url })
  await glProvider.postCommitStatus({ ...input, context: CONTEXT, token: accessToken })
}
