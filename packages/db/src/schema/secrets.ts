// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core';
import { apps } from './apps';
import { projects } from './projects';
import { databases } from './databases';

// Postgres bytea ↔ Buffer (mirrors SQLite blob({ mode: 'buffer' }))
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const secrets = pgTable('secrets', {
  id: text('id').primaryKey(),
  app_id: text('app_id').references(() => apps.id, { onDelete: 'cascade' }),
  project_id: text('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
  scope: text('scope', {
    enum: ['shared', 'prod', 'preview', 'dev'],
  }).notNull(),
  key: text('key').notNull(),
  value_ciphertext: bytea('value_ciphertext').notNull(),
  nonce: bytea('nonce').notNull(),
  linked_database_id: text('linked_database_id').references(() => databases.id, {
    onDelete: 'cascade',
  }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
