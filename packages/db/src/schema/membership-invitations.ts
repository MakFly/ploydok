// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { projects } from "./projects"
import { users } from "./users"

export const membership_invitations = pgTable(
  "membership_invitations",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(), // 'member' only in v1
    token_hash: text("token_hash").notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    invited_by: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accepted_at: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("membership_invitations_pending_org_email_unique")
      .on(table.org_id, sql`lower(btrim(${table.email}))`)
      .where(sql`${table.accepted_at} is null`),
    index("membership_invitations_org_id_idx").on(table.org_id),
    uniqueIndex("membership_invitations_token_hash_unique").on(table.token_hash),
  ]
)

export type InvitationRow = typeof membership_invitations.$inferSelect
export type InvitationInsert = typeof membership_invitations.$inferInsert
