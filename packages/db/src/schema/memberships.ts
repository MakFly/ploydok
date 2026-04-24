// SPDX-License-Identifier: AGPL-3.0-only
// TODO(lead): add seed to migration SQL - INSERT INTO memberships (id, org_id, user_id, role, invited_at, accepted_at)
// SELECT nanoid(), id, owner_id, 'owner'::text, created_at, created_at FROM projects ON CONFLICT DO NOTHING;
import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core"
import { projects } from "./projects"
import { users } from "./users"

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'owner' | 'member'
    invited_by: text("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    invited_at: timestamp("invited_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    accepted_at: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique().on(table.org_id, table.user_id),
    index("memberships_org_id_idx").on(table.org_id),
  ]
)

export type MembershipRow = typeof memberships.$inferSelect
export type MembershipInsert = typeof memberships.$inferInsert
