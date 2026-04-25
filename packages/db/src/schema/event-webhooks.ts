// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  customType,
} from "drizzle-orm/pg-core"
import { projects } from "./index"

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea"
  },
})

export const eventWebhooks = pgTable("event_webhooks", {
  id: text("id").primaryKey(),
  org_id: text("org_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret_enc: bytea("secret_enc"),
  secret_nonce: bytea("secret_nonce"),
  events: text("events").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  last_triggered_at: timestamp("last_triggered_at", { withTimezone: true }),
  last_response_status: integer("last_response_status"),
  last_response_body: text("last_response_body"),
  last_error: text("last_error"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
