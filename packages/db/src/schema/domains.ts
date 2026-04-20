// SPDX-License-Identifier: AGPL-3.0-only
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { apps } from "./apps"

export const domains = pgTable(
  "domains",
  {
    id: text("id").primaryKey(),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    // TLS certificate lifecycle: pending → issued | failed
    tls_status: text("tls_status", { enum: ["pending", "issued", "failed"] })
      .notNull()
      .default("pending"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // A hostname must be globally unique — one hostname can only belong to one app.
    uniqueIndex("domains_hostname_unique").on(t.hostname),
    index("domains_app_id_idx").on(t.app_id),
  ],
)

export type DomainRow = typeof domains.$inferSelect
export type DomainInsert = typeof domains.$inferInsert
