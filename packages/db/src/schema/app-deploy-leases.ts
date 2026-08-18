// SPDX-License-Identifier: AGPL-3.0-only
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { apps } from "./apps"
import { builds } from "./builds"

/** One durable, fenced deployment owner per application. */
export const app_deploy_leases = pgTable(
  "app_deploy_leases",
  {
    app_id: text("app_id")
      .primaryKey()
      .references(() => apps.id, { onDelete: "cascade" }),
    build_id: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    lease_token: text("lease_token").notNull(),
    heartbeat_at: timestamp("heartbeat_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    lease_until: timestamp("lease_until", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("app_deploy_leases_until_idx").on(t.lease_until)]
)
