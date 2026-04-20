// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core';
import { users } from './users';

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Per-user GitLab OAuth tokens (access + refresh). One row per user.
 * PK = user_id so OAuth reconnect is an UPSERT on user_id.
 */
export const gitlab_tokens = pgTable('gitlab_tokens', {
  user_id: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  access_token_enc: bytea('access_token_enc').notNull(),
  access_token_nonce: bytea('access_token_nonce').notNull(),
  refresh_token_enc: bytea('refresh_token_enc'),
  refresh_token_nonce: bytea('refresh_token_nonce'),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
});
