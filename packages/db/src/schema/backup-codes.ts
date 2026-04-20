// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const backup_codes = pgTable('backup_codes', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code_hash: text('code_hash').notNull(),
  consumed_at: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
