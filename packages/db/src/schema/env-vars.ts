// SPDX-License-Identifier: AGPL-3.0-only
import { index, pgTable, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core"
import { apps } from "./apps"

export const env_vars = pgTable(
  "env_vars",
  {
    id: text("id").primaryKey(),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    secret: boolean("secret").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Each (app_id, key) pair must be unique — env var names are per-app identifiers.
    uniqueIndex("env_vars_app_key_unique").on(t.app_id, t.key),
    index("env_vars_app_id_idx").on(t.app_id),
  ],
)

export type EnvVarRow = typeof env_vars.$inferSelect
export type EnvVarInsert = typeof env_vars.$inferInsert
