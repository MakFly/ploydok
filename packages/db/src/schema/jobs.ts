// SPDX-License-Identifier: AGPL-3.0-only
//
// legacy — BullMQ est la source de vérité pour les jobs actifs.
// Cette table est conservée pour audit trail (lecture seule) et
// pour le script de migration SQLite → Postgres.
//
import { index, pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type', {
      enum: ['deploy.requested', 'gc.registry', 'cleanup.build', 'app.delete.requested'],
    }).notNull(),
    payload: text('payload').notNull(), // JSON
    status: text('status', {
      enum: ['pending', 'running', 'done', 'failed'],
    })
      .notNull()
      .default('pending'),
    run_at: timestamp('run_at', { withTimezone: true, mode: 'date' }), // null = asap
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(3),
    error_message: text('error_message'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('jobs_status_run_at_idx').on(t.status, t.run_at)],
);

export const job_runs = pgTable('job_runs', {
  id: text('id').primaryKey(),
  job_id: text('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  error: text('error'),
});
