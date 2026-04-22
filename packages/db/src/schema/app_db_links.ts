// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { apps } from './apps'
import { databases } from './databases'

export const app_db_links = pgTable(
  'app_db_links',
  {
    id: text('id').primaryKey(),
    app_id: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    database_id: text('database_id')
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    env_prefix: text('env_prefix').notNull().default('DATABASE'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('app_db_links_unique').on(t.app_id, t.database_id, t.env_prefix)],
)

export type AppDbLinkRow = typeof app_db_links.$inferSelect
export type AppDbLinkInsert = typeof app_db_links.$inferInsert
