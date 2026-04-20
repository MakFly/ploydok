// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core';

/**
 * Singleton row (id = 'singleton') — instance-wide quota caps.
 * NULL on any limit column means "unlimited".
 * Written by admin routes; read by POST /apps quota enforcement.
 */
export const instance_settings = pgTable('instance_settings', {
  id: text('id').primaryKey(), // always 'singleton'
  max_apps_per_user: integer('max_apps_per_user'),
  max_total_memory_mb: integer('max_total_memory_mb'),
  max_total_cpu_cores: integer('max_total_cpu_cores'),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
});
