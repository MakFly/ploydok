// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, integer, customType } from 'drizzle-orm/pg-core';
import { users } from './users';

// Postgres bytea ↔ Buffer (mirrors SQLite blob({ mode: 'buffer' }))
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const passkeys = pgTable('passkeys', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credential_id: text('credential_id').notNull().unique(),
  public_key: bytea('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports').notNull().default('[]'),
  device_name: text('device_name'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true, mode: 'date' }).notNull(),
});
