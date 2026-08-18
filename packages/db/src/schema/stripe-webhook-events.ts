// SPDX-License-Identifier: AGPL-3.0-only
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Durable processing state for inbound Stripe events.
 *
 * `lease_token` fences stale workers while `lease_until` makes a claim
 * recoverable after a process crash. `processed_at` is the durable replay
 * boundary: completed event IDs are never claimed again.
 */
export const stripe_webhook_events = pgTable("stripe_webhook_events", {
  event_id: text("event_id").primaryKey(),
  event_type: text("event_type").notNull(),
  lease_token: text("lease_token"),
  lease_until: timestamp("lease_until", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  processed_at: timestamp("processed_at", {
    withTimezone: true,
    mode: "date",
  }),
  attempt_count: integer("attempt_count").notNull().default(1),
  last_error: text("last_error"),
  created_at: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type StripeWebhookEventRow = typeof stripe_webhook_events.$inferSelect
