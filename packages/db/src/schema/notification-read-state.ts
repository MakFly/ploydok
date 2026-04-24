// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./users"

// Per-user "last read at" cursor for the in-app notification bell.
// One row per user. Notifications older than `last_read_at` are considered
// already read by this user and don't bump the unread badge on reload.
export const notification_read_state = pgTable("notification_read_state", {
  user_id: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  last_read_at: timestamp("last_read_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date(0)),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})
