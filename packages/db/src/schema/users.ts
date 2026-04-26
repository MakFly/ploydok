// SPDX-License-Identifier: AGPL-3.0-only
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  display_name: text("display_name").notNull(),
  created_at: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  updated_at: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  recovery_token_hash: text("recovery_token_hash"),
  recovery_expires_at: timestamp("recovery_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  require_totp_for_secret_reveal: boolean("require_totp_for_secret_reveal")
    .notNull()
    .default(true),
})

export type UserRow = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert
