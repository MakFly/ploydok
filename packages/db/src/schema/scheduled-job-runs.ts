// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from "drizzle-orm"
import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { scheduled_jobs } from "./scheduled-jobs"

export const scheduled_job_runs = pgTable(
  "scheduled_job_runs",
  {
    id: text("id").primaryKey(),
    job_id: text("job_id")
      .notNull()
      .references(() => scheduled_jobs.id, { onDelete: "cascade" }),
    started_at: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    finished_at: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    status: text("status", {
      enum: ["running", "succeeded", "failed", "timeout"],
    }).notNull(),
    exit_code: integer("exit_code"),
    output: text("output"),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("scheduled_job_runs_one_running_per_job_idx")
      .on(t.job_id)
      .where(sql`${t.status} = 'running'`),
  ]
)

export type ScheduledJobRunRow = typeof scheduled_job_runs.$inferSelect
export type ScheduledJobRunInsert = typeof scheduled_job_runs.$inferInsert
