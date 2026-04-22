// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core"
import { users } from "./users"
import { projects } from "./projects"

const jsonb = customType<{ data: unknown; notNull: false; default: false }>({
  dataType() {
    return "jsonb"
  },
})

export const notification_channels = pgTable(
  "notification_channels",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    project_id: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", {
      enum: ["discord", "slack", "telegram", "whatsapp", "email"],
    }).notNull(),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    events: text("events").array().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    last_error: text("last_error"),
    last_sent_at: timestamp("last_sent_at", { withTimezone: true, mode: "date" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("notification_channels_owner_enabled_idx").on(t.owner_id, t.enabled)],
)
