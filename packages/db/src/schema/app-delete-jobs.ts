// SPDX-License-Identifier: AGPL-3.0-only
import { index, pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core"
import { users } from "./users"

export const app_delete_jobs = pgTable(
  "app_delete_jobs",
  {
    id: text("id").primaryKey(),
    // Keep the app id as an immutable audit pointer after the app row is deleted.
    app_id: text("app_id").notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    requested_by_user_id: text("requested_by_user_id").references(
      () => users.id
    ),
    source: text("source", {
      enum: [
        "api",
        "webhook:github",
        "webhook:gitlab",
        "cron:gc",
        "cron:cleanup",
        "auto:push",
        "auto:tag",
        "system",
      ],
    })
      .notNull()
      .default("api"),
    options: jsonb("options"),
    queued_at: timestamp("queued_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    claimed_at: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    finished_at: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    error_message: text("error_message"),
  },
  (t) => [
    index("app_delete_jobs_app_id_status_idx").on(t.app_id, t.status),
    index("app_delete_jobs_status_idx").on(t.status),
  ]
)

export type AppDeleteJobRow = typeof app_delete_jobs.$inferSelect
export type AppDeleteJobInsert = typeof app_delete_jobs.$inferInsert
