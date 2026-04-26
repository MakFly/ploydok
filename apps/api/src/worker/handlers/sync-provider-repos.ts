// SPDX-License-Identifier: AGPL-3.0-only
import {
  upsertInstallation,
  replaceInstallationRepos,
  getGitLabConfig,
} from "@ploydok/db/queries"
import type {
  ProviderInstallationRow,
  ProviderRepoRow,
} from "@ploydok/db/queries"
import type { Db } from "@ploydok/db"
import {
  gitlab_tokens,
  provider_credentials,
  provider_installations,
} from "@ploydok/db"
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm"
import { listAppInstallations } from "../../github/installation-tokens"
import { ghProvider } from "../../routes/github"
import { GitLabProvider } from "../../gitlab/client"
import { decryptField } from "../../github/app-credentials"
import { workerLog } from "../logger"
import { providerReposSyncQueue } from "../queues"
import { eventBus } from "../event-bus"
import { auditClaimed, auditUnauthorized } from "../queue-audit.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// `requestedBy` (optional) is the userId of the human who clicked Sync — used
// to scope progress events to their SSE channel. `syncId` is a per-click
// correlation id so the front can ignore events from concurrent syncs.
export type SyncProviderReposPayload =
  | {
      provider: "github"
      installationId?: string
      requestedBy?: string
      syncId?: string
    }
  | {
      provider: "gitlab"
      userId?: string
      requestedBy?: string
      syncId?: string
    }

// ---------------------------------------------------------------------------
// Enqueue helper (public — T2B/T2C depend on this)
// ---------------------------------------------------------------------------

export async function enqueueProviderReposSync(
  payload: SyncProviderReposPayload
): Promise<void> {
  const normalizedPayload =
    payload.provider === "github" && payload.installationId
      ? {
          ...payload,
          installationId: normalizeGitHubInstallationId(payload.installationId),
        }
      : payload

  // BullMQ rejects ":" in custom job ids (Redis key separator). Use "-".
  const target =
    normalizedPayload.provider === "github"
      ? `github-${normalizedPayload.installationId ?? "all"}`
      : `gitlab-${normalizedPayload.userId ?? "all"}`
  // Suffix with timestamp so repeated manual syncs each enqueue a fresh job
  // instead of being deduped against an already-running one.
  const jobId = `${target}-${Date.now()}`
  await providerReposSyncQueue.add(target, normalizedPayload, { jobId })
}

// ---------------------------------------------------------------------------
// CAS claim helper
// ---------------------------------------------------------------------------

async function claimProviderCredential(
  db: Db,
  credentialId: string
): Promise<boolean> {
  const result = await db
    .update(provider_credentials)
    .set({
      last_sync_status: "running",
      last_sync_claimed_at: sql`NOW()`,
    })
    .where(
      and(
        eq(provider_credentials.id, credentialId),
        inArray(provider_credentials.last_sync_status, ["pending", "running"])
      )
    )
    .returning()

  return result.length > 0
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleSyncProviderRepos(
  db: Db,
  payload: SyncProviderReposPayload
): Promise<void> {
  const ctx: SyncCtx = {
    syncId: payload.syncId,
    channel: payload.requestedBy ? `user:${payload.requestedBy}` : null,
    requestedBy: payload.requestedBy,
  }

  if (payload.provider === "github") {
    await syncGitHub(db, payload.installationId, ctx)
  } else {
    await syncGitLab(db, payload.userId, ctx)
  }
}

// ---------------------------------------------------------------------------
// Event-bus plumbing — every progress callsite goes through these helpers so
// the channel/syncId scoping stays consistent.
// ---------------------------------------------------------------------------

interface SyncCtx {
  syncId: string | undefined
  channel: string | null
  requestedBy: string | undefined
}

function emit(
  ctx: SyncCtx,
  type:
    | "provider.sync.started"
    | "provider.sync.progress"
    | "provider.sync.completed"
    | "provider.sync.failed",
  data: Record<string, unknown>,
  message: string
): void {
  if (!ctx.channel) return
  eventBus.publish(ctx.channel, {
    type,
    message,
    data: { ...data, syncId: ctx.syncId ?? null },
  })
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function normalizeGitHubInstallationId(installationId: string): string {
  return installationId.startsWith("github:")
    ? installationId.slice("github:".length)
    : installationId
}

function getGitHubInstallationDbId(installationId: string): string {
  return `github:${normalizeGitHubInstallationId(installationId)}`
}

async function deleteLegacyGitHubInstallationDuplicates(
  db: Db,
  installationId: string
): Promise<void> {
  const externalId = normalizeGitHubInstallationId(installationId)
  const dbId = getGitHubInstallationDbId(externalId)

  await db
    .delete(provider_installations)
    .where(
      and(
        eq(provider_installations.provider, "github"),
        eq(provider_installations.external_id, externalId),
        ne(provider_installations.id, dbId)
      )
    )
}

async function upsertLiveGitHubInstallation(
  db: Db,
  installation: Awaited<ReturnType<typeof listAppInstallations>>[number]
): Promise<void> {
  const installId = String(installation.id)
  const now = new Date()

  await deleteLegacyGitHubInstallationDuplicates(db, installId)
  await upsertInstallation(db, {
    id: getGitHubInstallationDbId(installId),
    provider: "github",
    external_id: installId,
    account_login: installation.accountLogin,
    account_type: installation.accountType,
    repository_selection: installation.repositorySelection,
    suspended_at: installation.suspendedAt
      ? new Date(installation.suspendedAt)
      : null,
    html_url: installation.htmlUrl,
    avatar_url: installation.avatarUrl,
    repository_count: null,
    last_synced_at: now,
    created_at: now,
  })
}

async function pruneStaleGitHubInstallations(
  db: Db,
  installations: Awaited<ReturnType<typeof listAppInstallations>>
): Promise<void> {
  const liveDbIds = installations.map((installation) =>
    getGitHubInstallationDbId(String(installation.id))
  )

  const credentialsWhere =
    liveDbIds.length === 0
      ? eq(provider_credentials.provider, "github")
      : and(
          eq(provider_credentials.provider, "github"),
          notInArray(provider_credentials.id, liveDbIds)
        )
  const installationsWhere =
    liveDbIds.length === 0
      ? eq(provider_installations.provider, "github")
      : and(
          eq(provider_installations.provider, "github"),
          notInArray(provider_installations.id, liveDbIds)
        )

  await db.delete(provider_credentials).where(credentialsWhere)
  await db.delete(provider_installations).where(installationsWhere)
}

async function syncGitHub(
  db: Db,
  installationId: string | undefined,
  ctx: SyncCtx
): Promise<void> {
  if (!installationId) {
    await syncGitHubFanOut(db, ctx)
    return
  }
  await syncGitHubInstallation(db, installationId, ctx)
}

async function syncGitHubFanOut(db: Db, ctx: SyncCtx): Promise<void> {
  const installations = await listAppInstallations()
  await pruneStaleGitHubInstallations(db, installations)
  workerLog.info(
    { count: installations.length },
    "github fan-out: enqueuing per-installation jobs"
  )

  emit(
    ctx,
    "provider.sync.started",
    {
      provider: "github",
      scope: "all",
      installationCount: installations.length,
    },
    `Found ${installations.length} GitHub installation(s) to sync`
  )

  for (const install of installations) {
    const installId = String(install.id)

    try {
      await upsertLiveGitHubInstallation(db, install)
    } catch (err) {
      workerLog.warn(
        { err, installId },
        "github fan-out: upsert installation failed, skipping"
      )
      continue
    }

    const credentialId = getGitHubInstallationDbId(installId)
    try {
      await db
        .insert(provider_credentials)
        .values({
          id: credentialId,
          provider: "github",
          credential_type: "installation",
          last_sync_status: "pending",
          last_sync_actor_user_id: ctx.requestedBy ?? null,
          last_sync_source: "system",
        })
        .onConflictDoUpdate({
          target: provider_credentials.id,
          set: {
            last_sync_status: "pending",
            last_sync_actor_user_id: ctx.requestedBy ?? null,
            last_sync_source: "system",
            updated_at: new Date(),
          },
        })
    } catch (err) {
      workerLog.warn(
        { err, credentialId },
        "github fan-out: upsert credential failed, skipping"
      )
      continue
    }

    await enqueueProviderReposSync({
      provider: "github",
      installationId: installId,
      ...(ctx.syncId !== undefined ? { syncId: ctx.syncId } : {}),
      ...(ctx.requestedBy !== undefined
        ? { requestedBy: ctx.requestedBy }
        : {}),
    })
  }
}

async function syncGitHubInstallation(
  db: Db,
  installationId: string,
  ctx: SyncCtx
): Promise<void> {
  const externalInstallationId = normalizeGitHubInstallationId(installationId)
  const dbInstallationId = getGitHubInstallationDbId(externalInstallationId)

  workerLog.info(
    { installationId: externalInstallationId },
    "github sync: starting"
  )
  const startedAt = Date.now()
  const credentialId = dbInstallationId

  const claimed = await claimProviderCredential(db, credentialId)
  if (!claimed) {
    auditUnauthorized({
      jobName: "provider.repos.sync",
      jobId: `sync-${credentialId}`,
      payload: { provider: "github", installationId: externalInstallationId },
      reason: "Credential not found or not in pending/running state",
    })
    throw new Error(
      `GitHub credential ${credentialId} not found or not in pending/running state`
    )
  }

  auditClaimed({
    jobName: "provider.repos.sync",
    jobId: `sync-${credentialId}`,
    rowId: credentialId,
    actor: ctx.requestedBy ?? null,
    source: "api",
  })

  emit(
    ctx,
    "provider.sync.started",
    {
      provider: "github",
      scope: "installation",
      installationId: dbInstallationId,
    },
    `Importing GitHub repositories for installation ${externalInstallationId}…`
  )

  try {
    const liveInstallations = await listAppInstallations()
    const liveInstallation = liveInstallations.find(
      (installation) => String(installation.id) === externalInstallationId
    )
    if (liveInstallation) {
      await upsertLiveGitHubInstallation(db, liveInstallation)
    }
  } catch (err) {
    workerLog.warn(
      { err, installationId: externalInstallationId },
      "github sync: live installation lookup failed"
    )
  }

  const allRepos: ProviderRepoRow[] = []
  const MAX_PAGES = 50
  const now = new Date()

  for (let page = 1; page <= MAX_PAGES; page++) {
    let result: {
      repos: {
        id: number | string
        fullName: string
        description: string | null
        defaultBranch: string
        private: boolean
      }[]
      hasMore: boolean
    }
    try {
      result = await ghProvider.listRepos(externalInstallationId, {
        page,
        perPage: 100,
      })
    } catch (err) {
      workerLog.warn(
        { err, installationId: externalInstallationId, page },
        "github sync: listRepos failed, stopping pagination"
      )
      emit(
        ctx,
        "provider.sync.failed",
        {
          provider: "github",
          installationId: dbInstallationId,
          page,
          error: err instanceof Error ? err.message : String(err),
        },
        `GitHub listRepos failed at page ${page}`
      )
      break
    }

    for (const repo of result.repos) {
      allRepos.push({
        id: `github:${repo.id}`,
        installation_id: dbInstallationId,
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

    emit(
      ctx,
      "provider.sync.progress",
      {
        provider: "github",
        installationId: dbInstallationId,
        page,
        reposFetched: allRepos.length,
        hasMore: result.hasMore,
      },
      `Imported ${allRepos.length} GitHub repos so far (page ${page})`
    )

    if (!result.hasMore) break
  }

  try {
    await replaceInstallationRepos(db, dbInstallationId, allRepos)
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "completed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.info(
      { installationId: externalInstallationId, count: allRepos.length },
      "github sync: done"
    )
    emit(
      ctx,
      "provider.sync.completed",
      {
        provider: "github",
        installationId: dbInstallationId,
        totalRepos: allRepos.length,
        durationMs: Date.now() - startedAt,
      },
      `Synced ${allRepos.length} GitHub repos`
    )
  } catch (err) {
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "failed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.error(
      { err, installationId: externalInstallationId },
      "github sync: replaceInstallationRepos failed"
    )
    emit(
      ctx,
      "provider.sync.failed",
      {
        provider: "github",
        installationId: dbInstallationId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to write GitHub repos to cache"
    )
    throw err
  }
}

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

async function syncGitLab(
  db: Db,
  userId: string | undefined,
  ctx: SyncCtx
): Promise<void> {
  if (!userId) {
    await syncGitLabFanOut(db, ctx)
    return
  }
  await syncGitLabUser(db, userId, ctx)
}

async function syncGitLabFanOut(db: Db, ctx: SyncCtx): Promise<void> {
  const rows = await db
    .select({ user_id: gitlab_tokens.user_id })
    .from(gitlab_tokens)
  workerLog.info(
    { count: rows.length },
    "gitlab fan-out: enqueuing per-user jobs"
  )
  emit(
    ctx,
    "provider.sync.started",
    { provider: "gitlab", scope: "all", installationCount: rows.length },
    `Found ${rows.length} GitLab user(s) to sync`
  )
  for (const row of rows) {
    const credentialId = `gitlab:user:${row.user_id}`
    try {
      await db
        .insert(provider_credentials)
        .values({
          id: credentialId,
          provider: "gitlab",
          credential_type: "user",
          last_sync_status: "pending",
          last_sync_actor_user_id: ctx.requestedBy ?? null,
          last_sync_source: "system",
        })
        .onConflictDoUpdate({
          target: provider_credentials.id,
          set: {
            last_sync_status: "pending",
            last_sync_actor_user_id: ctx.requestedBy ?? null,
            last_sync_source: "system",
            updated_at: new Date(),
          },
        })
    } catch (err) {
      workerLog.warn(
        { err, credentialId },
        "gitlab fan-out: upsert credential failed, skipping"
      )
      continue
    }

    await enqueueProviderReposSync({
      provider: "gitlab",
      userId: row.user_id,
      ...(ctx.syncId !== undefined ? { syncId: ctx.syncId } : {}),
      ...(ctx.requestedBy !== undefined
        ? { requestedBy: ctx.requestedBy }
        : {}),
    })
  }
}

async function syncGitLabUser(
  db: Db,
  userId: string,
  ctx: SyncCtx
): Promise<void> {
  workerLog.info({ userId }, "gitlab sync: starting")
  const startedAt = Date.now()
  const credentialId = `gitlab:user:${userId}`

  const claimed = await claimProviderCredential(db, credentialId)
  if (!claimed) {
    auditUnauthorized({
      jobName: "provider.repos.sync",
      jobId: `sync-${credentialId}`,
      payload: { provider: "gitlab", userId },
      reason: "Credential not found or not in pending/running state",
    })
    throw new Error(
      `GitLab credential ${credentialId} not found or not in pending/running state`
    )
  }

  auditClaimed({
    jobName: "provider.repos.sync",
    jobId: `sync-${credentialId}`,
    rowId: credentialId,
    actor: ctx.requestedBy ?? null,
    source: "api",
  })

  emit(
    ctx,
    "provider.sync.started",
    {
      provider: "gitlab",
      scope: "user",
      installationId: `gitlab:user:${userId}`,
    },
    `Importing GitLab projects for user ${userId}…`
  )

  const cfg = await getGitLabConfig(db)
  if (!cfg) {
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "failed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.warn({ userId }, "gitlab sync: no GitLab config, skipping")
    throw new Error("GitLab configuration not found")
  }

  const tokenRows = await db
    .select()
    .from(gitlab_tokens)
    .where(eq(gitlab_tokens.user_id, userId))
    .limit(1)

  const tokenRow = tokenRows[0]
  if (!tokenRow) {
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "failed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.warn({ userId }, "gitlab sync: no token found, skipping")
    throw new Error("GitLab token not found")
  }

  let accessToken: string
  try {
    accessToken = await decryptField(
      tokenRow.access_token_enc as Buffer,
      tokenRow.access_token_nonce as Buffer
    )
  } catch (err) {
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "failed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.warn(
      { err, userId },
      "gitlab sync: token decryption failed, skipping"
    )
    throw new Error("GitLab token decryption failed")
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
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "failed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.warn(
      { err, userId },
      "gitlab sync: upsert installation failed, skipping"
    )
    throw new Error("GitLab installation upsert failed")
  }

  const allRepos: ProviderRepoRow[] = []
  const MAX_PAGES = 50

  for (let page = 1; page <= MAX_PAGES; page++) {
    let result: {
      repos: {
        id: number | string
        fullName: string
        description: string | null
        defaultBranch: string
        private: boolean
        cloneUrl: string
      }[]
      hasMore: boolean
    }
    try {
      result = await provider.listRepos(accessToken, { page, perPage: 100 })
    } catch (err) {
      workerLog.warn(
        { err, userId, page },
        "gitlab sync: listRepos failed, stopping pagination"
      )
      emit(
        ctx,
        "provider.sync.failed",
        {
          provider: "gitlab",
          installationId,
          page,
          error: err instanceof Error ? err.message : String(err),
        },
        `GitLab listRepos failed at page ${page}`
      )
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

    emit(
      ctx,
      "provider.sync.progress",
      {
        provider: "gitlab",
        installationId,
        page,
        reposFetched: allRepos.length,
        hasMore: result.hasMore,
      },
      `Imported ${allRepos.length} GitLab projects so far (page ${page})`
    )

    if (!result.hasMore) break
  }

  try {
    await replaceInstallationRepos(db, installationId, allRepos)
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "completed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.info({ userId, count: allRepos.length }, "gitlab sync: done")
    emit(
      ctx,
      "provider.sync.completed",
      {
        provider: "gitlab",
        installationId,
        totalRepos: allRepos.length,
        durationMs: Date.now() - startedAt,
      },
      `Synced ${allRepos.length} GitLab projects`
    )
  } catch (err) {
    await db
      .update(provider_credentials)
      .set({
        last_sync_status: "failed",
        updated_at: new Date(),
      })
      .where(eq(provider_credentials.id, credentialId))
    workerLog.error(
      { err, userId },
      "gitlab sync: replaceInstallationRepos failed"
    )
    emit(
      ctx,
      "provider.sync.failed",
      {
        provider: "gitlab",
        installationId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to write GitLab projects to cache"
    )
    throw err
  }
}
