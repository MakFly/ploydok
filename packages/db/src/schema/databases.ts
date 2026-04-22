// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, integer, customType } from 'drizzle-orm/pg-core'
import { projects } from './projects'

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const databases = pgTable('databases', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['postgres', 'redis', 'mongo'] }).notNull(),
  name: text('name').notNull(),
  plan: text('plan', { enum: ['small', 'medium', 'large'] }).notNull(),
  container_id: text('container_id'),
  volume_name: text('volume_name').notNull(),
  connection_string_enc: bytea('connection_string_enc'),
  connection_string_nonce: bytea('connection_string_nonce'),
  master_password_enc: bytea('master_password_enc'),
  master_password_nonce: bytea('master_password_nonce'),
  status: text('status', {
    enum: ['creating', 'running', 'stopped', 'failed'],
  })
    .notNull()
    .default('creating'),
  host: text('host'),
  port: integer('port'),
  rotation_schedule: text('rotation_schedule', {
    enum: ['manual', '30d', '60d', '90d'],
  })
    .notNull()
    .default('manual'),
  password_rotated_at: timestamp('password_rotated_at', { withTimezone: true, mode: 'date' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type DatabaseRow = typeof databases.$inferSelect
export type DatabaseInsert = typeof databases.$inferInsert
