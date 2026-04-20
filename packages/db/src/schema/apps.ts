// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const apps = pgTable('apps', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status', {
    enum: ['created', 'pending', 'building', 'running', 'restarting', 'stopped', 'failed', 'deleting'],
  })
    .notNull()
    .default('created'),
  // Git source
  git_provider: text('git_provider', { enum: ['github'] }),
  repo_full_name: text('repo_full_name'),
  branch: text('branch'),
  github_installation_id: text('github_installation_id'),
  root_dir: text('root_dir'),
  dockerfile_path: text('dockerfile_path'),
  // Build overrides
  install_command: text('install_command'),
  build_command: text('build_command'),
  start_command: text('start_command'),
  watch_paths: text('watch_paths'), // JSON array
  build_method: text('build_method', { enum: ['docker', 'nixpacks', 'auto'] }),
  // Runtime
  container_id: text('container_id'),
  restart_policy: text('restart_policy', {
    enum: ['no', 'always', 'unless-stopped', 'on-failure'],
  })
    .notNull()
    .default('unless-stopped'),
  domain: text('domain'),
  // Registry GC override (null → fall back to global default of 3).
  keep_per_repo: integer('keep_per_repo'),
  // Healthcheck (intervals in seconds to match migration)
  healthcheck_path: text('healthcheck_path'),
  healthcheck_port: integer('healthcheck_port'),
  healthcheck_interval_s: integer('healthcheck_interval_s'),
  healthcheck_timeout_s: integer('healthcheck_timeout_s'),
  healthcheck_retries: integer('healthcheck_retries'),
  healthcheck_start_period_s: integer('healthcheck_start_period_s'),
  // Timestamps
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
});
