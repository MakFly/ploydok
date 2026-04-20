// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { gitlab_config, gitlab_tokens } from '../schema';

const SINGLETON_ID = 'singleton';

// ---------------------------------------------------------------------------
// GitLab OAuth app config (singleton)
// ---------------------------------------------------------------------------

export interface GitLabConfigInsert {
  instance_url: string;
  client_id: string;
  client_secret_enc: Buffer;
  client_secret_nonce: Buffer;
  webhook_secret_enc: Buffer;
  webhook_secret_nonce: Buffer;
}

export async function getGitLabConfig(
  db: Db,
): Promise<typeof gitlab_config.$inferSelect | null> {
  const rows = await db
    .select()
    .from(gitlab_config)
    .where(eq(gitlab_config.id, SINGLETON_ID))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveGitLabConfig(db: Db, cfg: GitLabConfigInsert): Promise<void> {
  await db.delete(gitlab_config).where(eq(gitlab_config.id, SINGLETON_ID));
  await db.insert(gitlab_config).values({
    id: SINGLETON_ID,
    instance_url: cfg.instance_url,
    client_id: cfg.client_id,
    client_secret_enc: cfg.client_secret_enc,
    client_secret_nonce: cfg.client_secret_nonce,
    webhook_secret_enc: cfg.webhook_secret_enc,
    webhook_secret_nonce: cfg.webhook_secret_nonce,
  });
}

export async function deleteGitLabConfig(db: Db): Promise<void> {
  await db.delete(gitlab_config).where(eq(gitlab_config.id, SINGLETON_ID));
}

// ---------------------------------------------------------------------------
// Per-user GitLab OAuth tokens
// ---------------------------------------------------------------------------

export interface GitLabTokenInsert {
  user_id: string;
  access_token_enc: Buffer;
  access_token_nonce: Buffer;
  refresh_token_enc: Buffer | null;
  refresh_token_nonce: Buffer | null;
  expires_at: Date | null;
}

export async function getGitLabTokens(
  db: Db,
  userId: string,
): Promise<typeof gitlab_tokens.$inferSelect | null> {
  const rows = await db
    .select()
    .from(gitlab_tokens)
    .where(eq(gitlab_tokens.user_id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertGitLabTokens(db: Db, t: GitLabTokenInsert): Promise<void> {
  await db.delete(gitlab_tokens).where(eq(gitlab_tokens.user_id, t.user_id));
  await db.insert(gitlab_tokens).values({
    user_id: t.user_id,
    access_token_enc: t.access_token_enc,
    access_token_nonce: t.access_token_nonce,
    refresh_token_enc: t.refresh_token_enc,
    refresh_token_nonce: t.refresh_token_nonce,
    expires_at: t.expires_at,
  });
}

export async function deleteGitLabTokens(db: Db, userId: string): Promise<void> {
  await db.delete(gitlab_tokens).where(eq(gitlab_tokens.user_id, userId));
}
