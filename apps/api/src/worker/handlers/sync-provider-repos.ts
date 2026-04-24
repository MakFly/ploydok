// SPDX-License-Identifier: AGPL-3.0-only
import {
  upsertInstallation,
  replaceInstallationRepos,
  getGitLabConfig,
} from "@ploydok/db/queries"
import type { ProviderInstallationRow, ProviderRepoRow } from "@ploydok/db/queries"
import type { Db } from "@ploydok/db"
import { gitlab_tokens } from "@ploydok/db"
import { eq } from "drizzle-orm"
import { listAppInstallations } from "../../github/installation-tokens"
import { ghProvider } from "../../routes/github"
import { GitLabProvider } from "../../gitlab/client"
import { decryptField } from "../../github/app-credentials"
import { workerLog } from "../logger"
import { providerReposSyncQueue } from "../queues"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncProviderReposPayload =
  | { provider: "github"; installationId?: string }
  | { provider: "gitlab"; userId?: string }

// ---------------------------------------------------------------------------
// Enqueue helper (public — T2B/T2C depend on this)
// ---------------------------------------------------------------------------

export async function enqueueProviderReposSync(
  payload: SyncProviderReposPayload,
): Promise<void> {
  // BullMQ rejects ":" in custom job ids (Redis key separator). Use "-".
  const target =
    payload.provider === "github"
      ? `github-${payload.installationId ?? "all"}`
      : `gitlab-${payload.userId ?? "all"}`
  // Suffix with timestamp so repeated manual syncs each enqueue a fresh job
  // instead of being deduped against an already-running one.
  const jobId = `${target}-${Date.now()}`
  await providerReposSyncQueue.add(target, payload, { jobId })
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleSyncProviderRepos(
  db: Db,
  payload: SyncProviderReposPayload,
): Promise<void> {
  if (payload.provider === "github") {
    await syncGitHub(db, payload.installationId)
  } else {
    await syncGitLab(db, payload.userId)
  }
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

async function syncGitHub(db: Db, installationId: string | undefined): Promise<void> {
  if (!installationId) {
    await syncGitHubFanOut(db)
    return
  }
  await syncGitHubInstallation(db, installationId)
}

async function syncGitHubFanOut(db: Db): Promise<void> {
  const installations = await listAppInstallations()
  workerLog.info({ count: installations.length }, "github fan-out: enqueuing per-installation jobs")

  for (const install of installations) {
    const installId = String(install.id)
    const now = new Date()

    const row: ProviderInstallationRow = {
      id: `github:${installId}`,
      provider: "github",
      external_id: installId,
      account_login: install.accountLogin,
      account_type: install.accountType,
      repository_selection: install.repositorySelection,
      suspended_at: install.suspendedAt ? new Date(install.suspendedAt) : null,
      html_url: install.htmlUrl,
      avatar_url: install.avatarUrl,
      repository_count: null,
      last_synced_at: now,
      created_at: now,
    }

    try {
      await upsertInstallation(db, row)
    } catch (err) {
      workerLog.warn({ err, installId }, "github fan-out: upsert installation failed, skipping")
      continue
    }

    await enqueueProviderReposSync({ provider: "github", installationId: installId })
  }
}

async function syncGitHubInstallation(db: Db, installationId: string): Promise<void> {
  workerLog.info({ installationId }, "github sync: starting")

  const allRepos: ProviderRepoRow[] = []
  const MAX_PAGES = 50
  const now = new Date()

  for (let page = 1; page <= MAX_PAGES; page++) {
    let result: { repos: { id: number | string; fullName: string; description: string | null; defaultBranch: string; private: boolean }[]; hasMore: boolean }
    try {
      result = await ghProvider.listRepos(installationId, { page, perPage: 100 })
    } catch (err) {
      workerLog.warn({ err, installationId, page }, "github sync: listRepos failed, stopping pagination")
      break
    }

    for (const repo of result.repos) {
      allRepos.push({
        id: `github:${repo.id}`,
        installation_id: `github:${installationId}`,
        provider: "github",
        full_name: repo.fullName,
        name: repo.fullName.split("/").at(-1) ?? repo.fullName,
        description: repo.description ?? null,
        default_branch: repo.defaultBranch ?? null,
        private: repo.private,
        html_url: `https://github.com/${repo.fullName}`,
        pushed_at: null,
        updated_at: null,
        last_synced_at: now,
      })
    }

    if (!result.hasMore) break
  }

  try {
    await replaceInstallationRepos(db, `github:${installationId}`, allRepos)
    workerLog.info({ installationId, count: allRepos.length }, "github sync: done")
  } catch (err) {
    workerLog.error({ err, installationId }, "github sync: replaceInstallationRepos failed")
    throw err
  }
}

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

async function syncGitLab(db: Db, userId: string | undefined): Promise<void> {
  if (!userId) {
    await syncGitLabFanOut(db)
    return
  }
  await syncGitLabUser(db, userId)
}

async function syncGitLabFanOut(db: Db): Promise<void> {
  const rows = await db.select({ user_id: gitlab_tokens.user_id }).from(gitlab_tokens)
  workerLog.info({ count: rows.length }, "gitlab fan-out: enqueuing per-user jobs")
  for (const row of rows) {
    await enqueueProviderReposSync({ provider: "gitlab", userId: row.user_id })
  }
}

async function syncGitLabUser(db: Db, userId: string): Promise<void> {
  workerLog.info({ userId }, "gitlab sync: starting")

  const cfg = await getGitLabConfig(db)
  if (!cfg) {
    workerLog.warn({ userId }, "gitlab sync: no GitLab config, skipping")
    return
  }

  const tokenRows = await db
    .select()
    .from(gitlab_tokens)
    .where(eq(gitlab_tokens.user_id, userId))
    .limit(1)

  const tokenRow = tokenRows[0]
  if (!tokenRow) {
    workerLog.warn({ userId }, "gitlab sync: no token found, skipping")
    return
  }

  let accessToken: string
  try {
    accessToken = await decryptField(
      tokenRow.access_token_enc as Buffer,
      tokenRow.access_token_nonce as Buffer,
    )
  } catch (err) {
    workerLog.warn({ err, userId }, "gitlab sync: token decryption failed, skipping")
    return
  }

  const provider = new GitLabProvider(cfg.instance_url)
  const installationId = `gitlab:user:${userId}`
  const now = new Date()

  const installRow: ProviderInstallationRow = {
    id: installationId,
    provider: "gitlab",
    external_id: userId,
    account_login: userId,
    account_type: "User",
    repository_selection: "all",
    suspended_at: null,
    html_url: null,
    avatar_url: null,
    repository_count: null,
    last_synced_at: now,
    created_at: now,
  }

  try {
    await upsertInstallation(db, installRow)
  } catch (err) {
    workerLog.warn({ err, userId }, "gitlab sync: upsert installation failed, skipping")
    return
  }

  const allRepos: ProviderRepoRow[] = []
  const MAX_PAGES = 50

  for (let page = 1; page <= MAX_PAGES; page++) {
    let result: { repos: { id: number | string; fullName: string; description: string | null; defaultBranch: string; private: boolean; cloneUrl: string }[]; hasMore: boolean }
    try {
      result = await provider.listRepos(accessToken, { page, perPage: 100 })
    } catch (err) {
      workerLog.warn({ err, userId, page }, "gitlab sync: listRepos failed, stopping pagination")
      break
    }

    for (const repo of result.repos) {
      allRepos.push({
        id: `gitlab:${repo.id}`,
        installation_id: installationId,
        provider: "gitlab",
        full_name: repo.fullName,
        name: repo.fullName.split("/").at(-1) ?? repo.fullName,
        description: repo.description ?? null,
        default_branch: repo.defaultBranch ?? null,
        private: repo.private,
        html_url: repo.cloneUrl.replace(/\.git$/, ""),
        pushed_at: null,
        updated_at: null,
        last_synced_at: now,
      })
    }

    if (!result.hasMore) break
  }

  try {
    await replaceInstallationRepos(db, installationId, allRepos)
    workerLog.info({ userId, count: allRepos.length }, "gitlab sync: done")
  } catch (err) {
    workerLog.error({ err, userId }, "gitlab sync: replaceInstallationRepos failed")
    throw err
  }
}
