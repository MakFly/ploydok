// SPDX-License-Identifier: AGPL-3.0-only
import { integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  refresh_token_hash: text('refresh_token_hash').notNull(),
  user_agent: text('user_agent').notNull(),
  ip: text('ip').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  last_seen_at: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  revoked_at: integer('revoked_at', { mode: 'timestamp' }),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
});
