// SPDX-License-Identifier: AGPL-3.0-only
import {
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { membership_invitations } from "./membership-invitations"

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea"
  },
})

/** Durable, encrypted events committed with their source state change. */
export const outbox_events = pgTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    invitation_id: text("invitation_id").unique(
      "outbox_events_invitation_id_unique"
    ),
    topic: text("topic").notNull(),
    payload_ciphertext: bytea("payload_ciphertext").notNull(),
    payload_nonce: bytea("payload_nonce").notNull(),
    available_at: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    lease_token: text("lease_token"),
    lease_until: timestamp("lease_until", {
      withTimezone: true,
      mode: "date",
    }),
    attempt_count: integer("attempt_count").notNull().default(0),
    delivered_at: timestamp("delivered_at", {
      withTimezone: true,
      mode: "date",
    }),
    dead_lettered_at: timestamp("dead_lettered_at", {
      withTimezone: true,
      mode: "date",
    }),
    last_error: text("last_error"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.invitation_id],
      foreignColumns: [membership_invitations.id],
      name: "outbox_events_invitation_id_fkey",
    }).onDelete("cascade"),
    index("outbox_events_pending_idx")
      .on(table.available_at, table.created_at)
      .where(
        sql`${table.delivered_at} IS NULL AND ${table.dead_lettered_at} IS NULL`
      ),
    index("outbox_events_active_invitation_lease_idx")
      .on(table.invitation_id, table.lease_until)
      .where(
        sql`${table.delivered_at} IS NULL AND ${table.dead_lettered_at} IS NULL`
      ),
  ]
)

export type OutboxEventRow = typeof outbox_events.$inferSelect
export type OutboxEventInsert = typeof outbox_events.$inferInsert
