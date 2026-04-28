// SPDX-License-Identifier: AGPL-3.0-only
import {
  customType,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { apps } from "./apps"
import { projects } from "./projects"
import { users } from "./users"

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea"
  },
})

export const cloudflare_connections = pgTable(
  "cloudflare_connections",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Cloudflare"),
    account_id: text("account_id"),
    api_token_enc: bytea("api_token_enc").notNull(),
    api_token_nonce: bytea("api_token_nonce").notNull(),
    created_by_user_id: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("cloudflare_connections_org_label_idx").on(
      table.org_id,
      table.label
    ),
  ]
)

export const app_cloudflare_cdn = pgTable("app_cloudflare_cdn", {
  app_id: text("app_id")
    .primaryKey()
    .references(() => apps.id, { onDelete: "cascade" }),
  connection_id: text("connection_id")
    .notNull()
    .references(() => cloudflare_connections.id, { onDelete: "cascade" }),
  zone_id: text("zone_id").notNull(),
  zone_name: text("zone_name"),
  hostname: text("hostname").notNull(),
  origin: text("origin").notNull(),
  dns_record_id: text("dns_record_id"),
  ruleset_id: text("ruleset_id"),
  ruleset_rule_id: text("ruleset_rule_id"),
  status: text("status", {
    enum: ["pending", "syncing", "configured", "failed"],
  })
    .notNull()
    .default("pending"),
  last_sync_error: text("last_sync_error"),
  synced_at: timestamp("synced_at", { withTimezone: true, mode: "date" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type CloudflareConnectionRow = typeof cloudflare_connections.$inferSelect
export type CloudflareConnectionInsert =
  typeof cloudflare_connections.$inferInsert
export type AppCloudflareCdnRow = typeof app_cloudflare_cdn.$inferSelect
export type AppCloudflareCdnInsert = typeof app_cloudflare_cdn.$inferInsert
