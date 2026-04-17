// SPDX-License-Identifier: AGPL-3.0-only
import { blob, integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';

/**
 * Singleton table — exactly one row with id='singleton'.
 * Encrypted fields use AES-256-GCM (keyring); nonce is stored alongside.
 */
export const github_app = sqliteTable('github_app', {
  id: text('id').primaryKey(), // always 'singleton'
  app_id: text('app_id').notNull(),
  client_id: text('client_id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  // AES-GCM encrypted blobs
  client_secret_enc: blob('client_secret_enc', { mode: 'buffer' }).notNull(),
  client_secret_nonce: blob('client_secret_nonce', { mode: 'buffer' }).notNull(),
  pem_enc: blob('pem_enc', { mode: 'buffer' }).notNull(),
  pem_nonce: blob('pem_nonce', { mode: 'buffer' }).notNull(),
  webhook_secret_enc: blob('webhook_secret_enc', { mode: 'buffer' }).notNull(),
  webhook_secret_nonce: blob('webhook_secret_nonce', { mode: 'buffer' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
