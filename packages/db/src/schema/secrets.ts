// SPDX-License-Identifier: AGPL-3.0-only
import { blob, integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { apps } from './apps';
import { projects } from './projects';

export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey(),
  app_id: text('app_id').references(() => apps.id, { onDelete: 'cascade' }),
  project_id: text('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
  scope: text('scope', {
    enum: ['shared', 'prod', 'preview', 'dev'],
  }).notNull(),
  key: text('key').notNull(),
  value_ciphertext: blob('value_ciphertext', { mode: 'buffer' }).notNull(),
  nonce: blob('nonce', { mode: 'buffer' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});
