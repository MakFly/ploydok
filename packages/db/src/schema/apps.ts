// SPDX-License-Identifier: AGPL-3.0-only
import { integer, text, sqliteTable } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status', {
    enum: ['created', 'building', 'running', 'stopped', 'failed'],
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
  domain: text('domain'),
  // Healthcheck (intervals in seconds to match migration)
  healthcheck_path: text('healthcheck_path'),
  healthcheck_port: integer('healthcheck_port'),
  healthcheck_interval_s: integer('healthcheck_interval_s'),
  healthcheck_timeout_s: integer('healthcheck_timeout_s'),
  healthcheck_retries: integer('healthcheck_retries'),
  healthcheck_start_period_s: integer('healthcheck_start_period_s'),
  // Timestamps
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
