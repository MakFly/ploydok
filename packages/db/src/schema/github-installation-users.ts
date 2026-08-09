// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./users"

/**
 * User connections to a GitHub App installation established by the signed
 * setup callback. Installations are global to the GitHub App, while each use
 * in Ploydok must remain scoped to a user who connected it.
 */
export const github_installation_users = pgTable(
  "github_installation_users",
  {
    installation_id: text("installation_id").notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.installation_id, table.user_id],
      name: "github_installation_users_pkey",
    }),
  })
)
