// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, integer, boolean, real, bigint, customType } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { registry_credentials } from './registry_credentials';

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

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
  // Git source / image source.
  // `bitbucket` will be added in a later sprint; schema placeholder in docs only.
  git_provider: text('git_provider', { enum: ['github', 'gitlab', 'image'] }),
  repo_full_name: text('repo_full_name'),
  branch: text('branch'),
  github_installation_id: text('github_installation_id'),
  gitlab_project_id: integer('gitlab_project_id'),
  root_dir: text('root_dir'),
  dockerfile_path: text('dockerfile_path'),
  // Image source (git_provider = 'image').
  image_ref: text('image_ref'),
  image_pull_policy: text('image_pull_policy', { enum: ['always', 'if_not_present'] }),
  registry_credential_id: text('registry_credential_id').references(
    () => registry_credentials.id,
    { onDelete: 'set null' },
  ),
  // Auto-redeploy on new :latest digest (opt-in, checked by BullMQ repeat job).
  track_latest: boolean('track_latest').notNull().default(false),
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
  // Quotas / plan. `custom` = no enforcement (back-compat for pre-sprint-3bis apps).
  plan: text('plan', { enum: ['nano', 'small', 'medium', 'large', 'custom'] })
    .notNull()
    .default('custom'),
  cpu_limit: real('cpu_limit'),
  mem_limit_bytes: bigint('mem_limit_bytes', { mode: 'number' }),
  pids_limit: integer('pids_limit'),
  // Webhook / auto-deploy settings
  auto_deploy_enabled: boolean('auto_deploy_enabled').notNull().default(true),
  post_commit_status: boolean('post_commit_status').notNull().default(true),
  coalesce_pushes: boolean('coalesce_pushes').notNull().default(true),
  deploy_on_tag: boolean('deploy_on_tag').notNull().default(false),
  tag_pattern: text('tag_pattern'),
  // Per-app webhook secret (encrypted, distinct from the GitHub App global secret)
  webhook_secret: bytea('webhook_secret'),
  webhook_secret_old: bytea('webhook_secret_old'),
  webhook_secret_old_expires_at: timestamp('webhook_secret_old_expires_at', { withTimezone: true, mode: 'date' }),
  // Timestamps
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
});
