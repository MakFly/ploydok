// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp, integer, unique } from "drizzle-orm/pg-core"
import { users } from "./users"

export const instance_license = pgTable(
  "instance_license",
  {
    id: text("id").primaryKey(), // always "default" — singleton
    license_id: text("license_id").notNull(), // claim du JWT, pour anti-replay
    plan: text("plan", { enum: ["pro", "enterprise"] }).notNull(),
    seats: integer("seats").notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    activated_at: timestamp("activated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    activated_by: text("activated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    jwt: text("jwt").notNull(), // stocké pour audit/re-verify
  },
  (table) => [unique().on(table.id)]
)

export type InstanceLicenseRow = typeof instance_license.$inferSelect
export type InstanceLicenseInsert = typeof instance_license.$inferInsert
