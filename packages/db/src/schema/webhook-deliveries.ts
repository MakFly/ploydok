// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  index,
  customType,
} from 'drizzle-orm/pg-core'
import { apps } from './apps'
import { builds } from './builds'

const jsonb = customType<{ data: unknown; notNull: false; default: false }>({
  dataType() {
    return 'jsonb'
  },
})

// postgres.js (Bun) chokes on Buffer instances coming through Drizzle's default
// path — the prepared statement bind step sees a plain Object and bails with
// `byteLength` errors. We type the bind value as Uint8Array (Buffer is a
// subclass) so callers must pass Uint8Array — that satisfies postgres.js
// instanceof check directly, no toDriver gymnastics needed.
const bytea = customType<{
  data: Uint8Array
  notNull: false
  default: false
}>({
  dataType() {
    return 'bytea'
  },
})

export const webhook_deliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    app_id: text('app_id').references(() => apps.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['github', 'gitlab'] }).notNull(),
    delivery_external_id: text('delivery_external_id'),
    event: text('event').notNull(),
    ref: text('ref'),
    commit_sha: text('commit_sha'),
    commit_message: text('commit_message'),
    signature_valid: boolean('signature_valid').notNull(),
    decision: text('decision', {
      enum: [
        'enqueued',
        'skipped_disabled',
        'skipped_branch',
        'skipped_path',
        'skipped_directive',
        'skipped_unknown_app',
        'skipped_tag_disabled',
        'skipped_tag_pattern',
        'invalid_signature',
        'error',
        'coalesced',
        'retried',
      ],
    }).notNull(),
    decision_reason: text('decision_reason'),
    build_id: text('build_id').references(() => builds.id, { onDelete: 'set null' }),
    payload_hash: text('payload_hash').notNull(),
    payload_sample: jsonb('payload_sample'),
    payload_raw: bytea('payload_raw'),
    payload_raw_expires_at: timestamp('payload_raw_expires_at', { withTimezone: true, mode: 'date' }),
    payload_truncated: boolean('payload_truncated').notNull().default(false),
    source: text('source', { enum: ['webhook', 'replay'] }).notNull().default('webhook'),
    // Self-referencing FK for replay chains
    parent_delivery_id: text('parent_delivery_id'),
    retry_count: integer('retry_count').notNull().default(0),
    received_at: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    processed_at: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('wh_del_app_received_idx').on(t.app_id, t.received_at),
    index('wh_del_payload_hash_idx').on(t.payload_hash),
    index('wh_del_parent_delivery_idx').on(t.parent_delivery_id),
  ],
)
