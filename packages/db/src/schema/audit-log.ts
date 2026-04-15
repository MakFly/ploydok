// SPDX-License-Identifier: AGPL-3.0-only
import { integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const audit_log = sqliteTable('audit_log', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  user_id: text('user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(),
  target_type: text('target_type').notNull(),
  target_id: text('target_id').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  prev_hash: text('prev_hash'),
  hash: text('hash'),
});
