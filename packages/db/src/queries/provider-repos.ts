// SPDX-License-Identifier: AGPL-3.0-only
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  min,
  notInArray,
  or,
  sql,
} from "drizzle-orm"
import { provider_installations, provider_repos } from "../schema"
import type { Db } from "../client"
import type { InferSelectModel } from "drizzle-orm"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderInstallationRow = InferSelectModel<typeof provider_installations>
export type ProviderRepoRow = InferSelectModel<typeof provider_repos>

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export async function listRepos(
  db: Db,
  opts: {
    provider: "github" | "gitlab"
    search?: string
    limit: number
    offset: number
  },
): Promise<{ rows: ProviderRepoRow[]; total: number }> {
  const { provider, search, limit, offset } = opts

  const providerFilter = eq(provider_repos.provider, provider)
  const searchFilter = search
    ? or(
        sql`${provider_repos.full_name} ILIKE ${`%${search}%`}`,
        sql`${provider_repos.description} ILIKE ${`%${search}%`}`,
      )
    : undefined

  const where = searchFilter ? and(providerFilter, searchFilter) : providerFilter

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(provider_repos)
      .where(where)
      .orderBy(
        sql`${provider_repos.pushed_at} DESC NULLS LAST`,
        asc(provider_repos.full_name),
      )
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(provider_repos).where(where),
  ])

  return { rows, total: totalRow?.total ?? 0 }
}

// ---------------------------------------------------------------------------
// Installations
// ---------------------------------------------------------------------------

export async function upsertInstallation(
  db: Db,
  row: ProviderInstallationRow,
): Promise<void> {
  await db
    .insert(provider_installations)
    .values(row)
    .onConflictDoUpdate({
      target: [
        provider_installations.provider,
        provider_installations.external_id,
      ],
      set: {
        id: row.id,
        provider: row.provider,
        external_id: row.external_id,
        account_login: row.account_login,
        account_type: row.account_type,
        repository_selection: row.repository_selection,
        suspended_at: row.suspended_at,
        html_url: row.html_url,
        avatar_url: row.avatar_url,
        repository_count: row.repository_count,
        last_synced_at: sql`now()`,
      },
    })
}

export async function deleteInstallation(db: Db, id: string): Promise<void> {
  await db
    .delete(provider_installations)
    .where(eq(provider_installations.id, id))
}

export async function listInstallations(
  db: Db,
  provider: "github" | "gitlab",
): Promise<ProviderInstallationRow[]> {
  return db
    .select()
    .from(provider_installations)
    .where(eq(provider_installations.provider, provider))
}

export async function getInstallationStaleness(
  db: Db,
  provider: "github" | "gitlab",
): Promise<{ mostStaleAt: Date | null; count: number }> {
  const [row] = await db
    .select({
      mostStaleAt: min(provider_installations.last_synced_at),
      count: count(),
    })
    .from(provider_installations)
    .where(eq(provider_installations.provider, provider))

  return {
    mostStaleAt: row?.mostStaleAt ?? null,
    count: row?.count ?? 0,
  }
}

export interface CacheStatusRow {
  id: string
  externalId: string
  accountLogin: string
  avatarUrl: string | null
  htmlUrl: string | null
  lastSyncedAt: Date
  repoCount: number
}

export async function getCacheStatus(
  db: Db,
  provider: "github" | "gitlab",
  installationIdFilter?: string,
): Promise<CacheStatusRow[]> {
  const where = installationIdFilter
    ? and(
        eq(provider_installations.provider, provider),
        eq(provider_installations.id, installationIdFilter),
      )
    : eq(provider_installations.provider, provider)

  const rows = await db
    .select({
      id: provider_installations.id,
      externalId: provider_installations.external_id,
      accountLogin: provider_installations.account_login,
      avatarUrl: provider_installations.avatar_url,
      htmlUrl: provider_installations.html_url,
      lastSyncedAt: provider_installations.last_synced_at,
      repoCount: sql<number>`count(${provider_repos.id})::int`,
    })
    .from(provider_installations)
    .leftJoin(
      provider_repos,
      eq(provider_repos.installation_id, provider_installations.id),
    )
    .where(where)
    .groupBy(provider_installations.id)
    .orderBy(asc(provider_installations.account_login))

  return rows
}

// ---------------------------------------------------------------------------
// Repos mutations
// ---------------------------------------------------------------------------

export async function upsertRepos(
  db: Db,
  rows: ProviderRepoRow[],
): Promise<void> {
  if (rows.length === 0) return

  await db
    .insert(provider_repos)
    .values(rows)
    .onConflictDoUpdate({
      target: provider_repos.id,
      set: {
        installation_id: sql`excluded.installation_id`,
        provider: sql`excluded.provider`,
        full_name: sql`excluded.full_name`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        default_branch: sql`excluded.default_branch`,
        private: sql`excluded.private`,
        html_url: sql`excluded.html_url`,
        pushed_at: sql`excluded.pushed_at`,
        updated_at: sql`excluded.updated_at`,
        last_synced_at: sql`now()`,
      },
    })
}

export async function deleteRepos(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  await db.delete(provider_repos).where(inArray(provider_repos.id, ids))
}

export async function replaceInstallationRepos(
  db: Db,
  installationId: string,
  rows: ProviderRepoRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await upsertRepos(tx as unknown as Db, rows)

    if (rows.length > 0) {
      const upsertedIds = rows.map((r) => r.id)
      await tx
        .delete(provider_repos)
        .where(
          and(
            eq(provider_repos.installation_id, installationId),
            notInArray(provider_repos.id, upsertedIds),
          ),
        )
    } else {
      await tx
        .delete(provider_repos)
        .where(eq(provider_repos.installation_id, installationId))
    }
  })
}
