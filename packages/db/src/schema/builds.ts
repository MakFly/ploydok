// SPDX-License-Identifier: AGPL-3.0-only
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { apps } from './apps';

export const builds = pgTable(
  'builds',
  {
    id: text('id').primaryKey(),
    app_id: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'running', 'succeeded', 'succeeded_with_warning', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    build_method: text('build_method', { enum: ['docker', 'nixpacks'] }),
    image_tag: text('image_tag'),
    container_id: text('container_id'),
    commit_sha: text('commit_sha'),
    commit_message: text('commit_message'),
    log_path: text('log_path'),
    error_message: text('error_message'),
    // Set when post-deploy hook fails (build is still considered succeeded)
    post_deploy_error: text('post_deploy_error'),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('builds_app_id_idx').on(t.app_id),
    index('builds_status_idx').on(t.status),
  ],
);
