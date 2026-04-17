// SPDX-License-Identifier: AGPL-3.0-only
import { index, integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type', {
      enum: ['deploy.requested', 'gc.registry', 'cleanup.build'],
    }).notNull(),
    payload: text('payload').notNull(), // JSON
    status: text('status', {
      enum: ['pending', 'running', 'done', 'failed'],
    })
      .notNull()
      .default('pending'),
    run_at: integer('run_at', { mode: 'timestamp_ms' }), // null = asap
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(3),
    error_message: text('error_message'),
    created_at: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('jobs_status_run_at_idx').on(t.status, t.run_at)],
);

export const job_runs = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  job_id: text('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  started_at: integer('started_at', { mode: 'timestamp_ms' }),
  finished_at: integer('finished_at', { mode: 'timestamp_ms' }),
  error: text('error'),
});
