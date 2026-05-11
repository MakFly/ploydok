// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  refresh_token_hash: text('refresh_token_hash').notNull(),
  user_agent: text('user_agent').notNull(),
  ip: text('ip').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
  rotated_at: timestamp('rotated_at', { withTimezone: true, mode: 'date' }),
  revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});
