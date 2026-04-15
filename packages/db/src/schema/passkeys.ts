// SPDX-License-Identifier: AGPL-3.0-only
import { blob, integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const passkeys = sqliteTable('passkeys', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credential_id: text('credential_id').notNull().unique(),
  public_key: blob('public_key', { mode: 'buffer' }).notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports').notNull().default('[]'),
  device_name: text('device_name'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  last_used_at: integer('last_used_at', { mode: 'timestamp' }).notNull(),
});
