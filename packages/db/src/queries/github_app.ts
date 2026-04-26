// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { github_app } from '../schema';

const SINGLETON_ID = 'singleton';

export interface GitHubAppConfig {
  app_id: string;
  client_id: string;
  slug: string;
  name: string;
  client_secret_enc: Buffer;
  client_secret_nonce: Buffer;
  pem_enc: Buffer;
  pem_nonce: Buffer;
  webhook_secret_enc: Buffer;
  webhook_secret_nonce: Buffer;
}

/** Returns the stored GitHub App config, or null if not yet created. */
export async function getGitHubAppConfig(db: Db): Promise<(typeof github_app.$inferSelect) | null> {
  const rows = await db
    .select()
    .from(github_app)
    .where(eq(github_app.id, SINGLETON_ID))
    .limit(1);
  return rows[0] ?? null;
}

/** Upserts the singleton GitHub App config. */
export async function saveGitHubAppConfig(db: Db, cfg: GitHubAppConfig): Promise<void> {
  const row = {
    id: SINGLETON_ID,
    app_id: cfg.app_id,
    client_id: cfg.client_id,
    slug: cfg.slug,
    name: cfg.name,
    client_secret_enc: cfg.client_secret_enc,
    client_secret_nonce: cfg.client_secret_nonce,
    pem_enc: cfg.pem_enc,
    pem_nonce: cfg.pem_nonce,
    webhook_secret_enc: cfg.webhook_secret_enc,
    webhook_secret_nonce: cfg.webhook_secret_nonce,
  };

  await db
    .insert(github_app)
    .values(row)
    .onConflictDoUpdate({
      target: github_app.id,
      set: {
        app_id: row.app_id,
        client_id: row.client_id,
        slug: row.slug,
        name: row.name,
        client_secret_enc: row.client_secret_enc,
        client_secret_nonce: row.client_secret_nonce,
        pem_enc: row.pem_enc,
        pem_nonce: row.pem_nonce,
        webhook_secret_enc: row.webhook_secret_enc,
        webhook_secret_nonce: row.webhook_secret_nonce,
      },
    });
}

/** Deletes the singleton GitHub App config (used by the reset flow). */
export async function deleteGitHubAppConfig(db: Db): Promise<void> {
  await db.delete(github_app).where(eq(github_app.id, SINGLETON_ID));
}
