// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const audit_log = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  user_id: text('user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(),
  target_type: text('target_type').notNull(),
  target_id: text('target_id').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  prev_hash: text('prev_hash'),
  hash: text('hash'),
});
