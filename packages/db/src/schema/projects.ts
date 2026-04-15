// SPDX-License-Identifier: AGPL-3.0-only
import { integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  owner_id: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});
