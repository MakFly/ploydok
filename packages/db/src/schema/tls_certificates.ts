// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, uniqueIndex, customType } from 'drizzle-orm/pg-core'
import { apps } from './apps'

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const tls_certificates = pgTable(
  'tls_certificates',
  {
    id: text('id').primaryKey(),
    app_id: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    cert_enc: bytea('cert_enc'),
    cert_nonce: bytea('cert_nonce'),
    key_enc: bytea('key_enc'),
    key_nonce: bytea('key_nonce'),
    not_before: timestamp('not_before', { withTimezone: true, mode: 'date' }),
    not_after: timestamp('not_after', { withTimezone: true, mode: 'date' }),
    last_alert_sent_at: timestamp('last_alert_sent_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex('tls_certificates_app_domain_idx').on(table.app_id, table.domain)],
)

export type TlsCertRow = typeof tls_certificates.$inferSelect
export type TlsCertInsert = typeof tls_certificates.$inferInsert
