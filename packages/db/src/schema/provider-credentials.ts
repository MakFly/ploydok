// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./users"

export const provider_credentials = pgTable("provider_credentials", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  credential_type: text("credential_type").notNull(),
  last_sync_status: text("last_sync_status", {
    enum: ["pending", "running", "completed", "failed"],
  }).default("pending"),
  last_sync_actor_user_id: text("last_sync_actor_user_id").references(
    () => users.id
  ),
  last_sync_source: text("last_sync_source", {
    enum: [
      "api",
      "webhook:github",
      "webhook:gitlab",
      "cron:gc",
      "cron:cleanup",
      "auto:push",
      "auto:tag",
      "system",
    ],
  }),
  last_sync_claimed_at: timestamp("last_sync_claimed_at", {
    withTimezone: true,
    mode: "date",
  }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type ProviderCredentialRow = typeof provider_credentials.$inferSelect
export type ProviderCredentialInsert = typeof provider_credentials.$inferInsert
