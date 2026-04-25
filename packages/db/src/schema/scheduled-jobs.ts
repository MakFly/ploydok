// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"
import { apps } from "./apps"

export const scheduled_jobs = pgTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  org_id: text("org_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  schedule_cron: text("schedule_cron").notNull(),
  kind: text("kind", { enum: ["app_exec", "container_run"] }).notNull(),
  app_id: text("app_id").references(() => apps.id, { onDelete: "cascade" }),
  image: text("image"),
  command: text("command").array(),
  env: jsonb("env").notNull().default({}),
  timeout_seconds: integer("timeout_seconds").notNull().default(300),
  enabled: boolean("enabled").notNull().default(true),
  last_run_at: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
  last_run_status: text("last_run_status", {
    enum: ["succeeded", "failed", "timeout", "running"],
  }),
  next_run_at: timestamp("next_run_at", { withTimezone: true, mode: "date" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type ScheduledJobRow = typeof scheduled_jobs.$inferSelect
export type ScheduledJobInsert = typeof scheduled_jobs.$inferInsert
