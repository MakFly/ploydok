// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/** Durable BullMQ dispatch intents committed with their source state change. */
export const queue_outbox_events = pgTable(
  "queue_outbox_events",
  {
    id: text("id").primaryKey(),
    queue_name: text("queue_name").notNull(),
    job_name: text("job_name").notNull(),
    job_id: text("job_id").notNull(),
    source_row_id: text("source_row_id").notNull(),
    actor_user_id: text("actor_user_id"),
    source: text("source").notNull().default("system"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    job_options: jsonb("job_options")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    available_at: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    lease_token: text("lease_token"),
    lease_until: timestamp("lease_until", {
      withTimezone: true,
      mode: "date",
    }),
    attempt_count: integer("attempt_count").notNull().default(0),
    dispatched_at: timestamp("dispatched_at", {
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
    uniqueIndex("queue_outbox_events_queue_job_unique").on(
      table.queue_name,
      table.job_id
    ),
    index("queue_outbox_events_pending_idx")
      .on(table.available_at, table.created_at)
      .where(sql`${table.dispatched_at} IS NULL`),
    check(
      "queue_outbox_events_payload_object_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`
    ),
    check(
      "queue_outbox_events_job_options_object_check",
      sql`jsonb_typeof(${table.job_options}) = 'object'`
    ),
    check(
      "queue_outbox_events_attempt_count_check",
      sql`${table.attempt_count} >= 0`
    ),
  ]
)

export type QueueOutboxEventRow = typeof queue_outbox_events.$inferSelect
export type QueueOutboxEventInsert = typeof queue_outbox_events.$inferInsert
