// SPDX-License-Identifier: AGPL-3.0-only
import { index, integer, text, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core"
import { apps } from "./apps"

export const domains = sqliteTable(
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
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
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
