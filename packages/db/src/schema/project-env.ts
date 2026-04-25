// SPDX-License-Identifier: AGPL-3.0-only
import {
  index,
  pgTable,
  text,
  timestamp,
  boolean,
  customType,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea"
  },
})

export const project_env_vars = pgTable(
  "project_env_vars",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value_enc: bytea("value_enc").notNull(),
    value_nonce: bytea("value_nonce").notNull(),
    is_secret: boolean("is_secret").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Each (project_id, key) pair must be unique — env var names are per-project identifiers.
    uniqueIndex("project_env_vars_project_key_unique").on(t.project_id, t.key),
    index("project_env_vars_project_id_idx").on(t.project_id),
  ]
)

export type ProjectEnvVarRow = typeof project_env_vars.$inferSelect
export type ProjectEnvVarInsert = typeof project_env_vars.$inferInsert
