// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const org_branding = pgTable("org_branding", {
  org_id: text("org_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  app_name: text("app_name").notNull().default("Ploydok"),
  logo_url: text("logo_url"),
  primary_color: text("primary_color"),
  favicon_url: text("favicon_url"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type OrgBrandingRow = typeof org_branding.$inferSelect
export type OrgBrandingInsert = typeof org_branding.$inferInsert
