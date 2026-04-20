// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  owner_id: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Per-project Docker network (lazily created by ensureProjectNetwork).
  network_name: text('network_name'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
