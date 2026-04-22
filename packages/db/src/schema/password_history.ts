// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core'
import { databases } from './databases'

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const password_history = pgTable('password_history', {
  id: text('id').primaryKey(),
  database_id: text('database_id')
    .notNull()
    .references(() => databases.id, { onDelete: 'cascade' }),
  // Encrypted previous password — kept during double-write window
  password_enc: bytea('password_enc').notNull(),
  nonce: bytea('nonce').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type PasswordHistoryRow = typeof password_history.$inferSelect
export type PasswordHistoryInsert = typeof password_history.$inferInsert
