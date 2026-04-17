// SPDX-License-Identifier: AGPL-3.0-only
import { index, integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { apps } from './apps';

export const builds = sqliteTable(
  'builds',
  {
    id: text('id').primaryKey(),
    app_id: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    build_method: text('build_method', { enum: ['docker', 'nixpacks'] }),
    image_tag: text('image_tag'),
    container_id: text('container_id'),
    commit_sha: text('commit_sha'),
    log_path: text('log_path'),
    error_message: text('error_message'),
    started_at: integer('started_at', { mode: 'timestamp_ms' }),
    finished_at: integer('finished_at', { mode: 'timestamp_ms' }),
    created_at: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('builds_app_id_idx').on(t.app_id),
    index('builds_status_idx').on(t.status),
  ],
);
