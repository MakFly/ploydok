// SPDX-License-Identifier: AGPL-3.0-only
import { index, integer, text, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core"
import { apps } from "./apps"

export const env_vars = sqliteTable(
  "env_vars",
  {
    id: text("id").primaryKey(),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    // SQLite stores booleans as integers. 0 = false, 1 = true.
    secret: integer("secret").notNull().default(0),
    created_at: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp" })
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
