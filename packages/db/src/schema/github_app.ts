// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core';

// Postgres bytea ↔ Buffer (mirrors SQLite blob({ mode: 'buffer' }))
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * Singleton table — exactly one row with id='singleton'.
 * Encrypted fields use AES-256-GCM (keyring); nonce is stored alongside.
 */
export const github_app = pgTable('github_app', {
  id: text('id').primaryKey(), // always 'singleton'
  app_id: text('app_id').notNull(),
  client_id: text('client_id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  // AES-GCM encrypted blobs
  client_secret_enc: bytea('client_secret_enc').notNull(),
  client_secret_nonce: bytea('client_secret_nonce').notNull(),
  pem_enc: bytea('pem_enc').notNull(),
  pem_nonce: bytea('pem_nonce').notNull(),
  webhook_secret_enc: bytea('webhook_secret_enc').notNull(),
  webhook_secret_nonce: bytea('webhook_secret_nonce').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
});
