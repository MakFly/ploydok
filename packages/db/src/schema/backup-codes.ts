// SPDX-License-Identifier: AGPL-3.0-only
import { integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const backup_codes = sqliteTable('backup_codes', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code_hash: text('code_hash').notNull(),
  consumed_at: integer('consumed_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});
