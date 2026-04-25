// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"

export const api_tokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token_hash: text("token_hash").notNull(),
    last_used_at: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [uniqueIndex("api_tokens_token_hash_unique").on(table.token_hash)]
)

export type ApiTokenRow = typeof api_tokens.$inferSelect
export type ApiTokenInsert = typeof api_tokens.$inferInsert
