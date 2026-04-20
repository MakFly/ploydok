// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core';
import { users } from './users';

// Postgres bytea ↔ Buffer (mirrors schema/github_app.ts).
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Docker-registry credentials owned by a user.
 * AES-256-GCM encrypted password; nonce stored alongside.
 * Reuse `encryptField` / `decryptField` from apps/api/src/github/app-credentials.ts.
 */
export const registry_credentials = pgTable('registry_credentials', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  registry_host: text('registry_host').notNull(),
  username: text('username').notNull(),
  password_enc: bytea('password_enc').notNull(),
  password_nonce: bytea('password_nonce').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
});
