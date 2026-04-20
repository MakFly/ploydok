// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Singleton row (id = 'singleton'). Holds the GitLab OAuth application
 * credentials for the whole Ploydok instance (one instance can target
 * gitlab.com OR a single self-hosted GitLab instance).
 * Encrypted fields mirror `github_app`.
 */
export const gitlab_config = pgTable('gitlab_config', {
  id: text('id').primaryKey(), // always 'singleton'
  instance_url: text('instance_url').notNull().default('https://gitlab.com'),
  client_id: text('client_id').notNull(),
  client_secret_enc: bytea('client_secret_enc').notNull(),
  client_secret_nonce: bytea('client_secret_nonce').notNull(),
  webhook_secret_enc: bytea('webhook_secret_enc').notNull(),
  webhook_secret_nonce: bytea('webhook_secret_nonce').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
});
