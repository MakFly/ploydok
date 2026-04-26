// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  customType,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea"
  },
})

export const databases = pgTable("databases", {
  id: text("id").primaryKey(),
  project_id: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["postgres", "mysql", "mariadb", "redis", "mongo", "libsql"],
  }).notNull(),
  version: text("version").notNull().default(""),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["small", "medium", "large"] }).notNull(),
  container_id: text("container_id"),
  volume_name: text("volume_name").notNull(),
  connection_string_enc: bytea("connection_string_enc"),
  connection_string_nonce: bytea("connection_string_nonce"),
  master_password_enc: bytea("master_password_enc"),
  master_password_nonce: bytea("master_password_nonce"),
  status: text("status", {
    enum: ["creating", "starting", "running", "stopped", "degraded", "failed"],
  })
    .notNull()
    .default("creating"),
  health_status: text("health_status", {
    enum: ["unknown", "starting", "healthy", "degraded", "unhealthy"],
  })
    .notNull()
    .default("unknown"),
  host: text("host"),
  port: integer("port"),
  exposure_mode: text("exposure_mode", {
    enum: ["internal", "direct_port", "public_proxy"],
  })
    .notNull()
    .default("internal"),
  public_enabled: boolean("public_enabled").notNull().default(false),
  public_port: integer("public_port"),
  public_host: text("public_host"),
  public_url: text("public_url"),
  rotation_schedule: text("rotation_schedule", {
    enum: ["manual", "30d", "60d", "90d"],
  })
    .notNull()
    .default("manual"),
  rotation_in_progress: boolean("rotation_in_progress")
    .notNull()
    .default(false),
  password_rotated_at: timestamp("password_rotated_at", {
    withTimezone: true,
    mode: "date",
  }),
  last_started_at: timestamp("last_started_at", {
    withTimezone: true,
    mode: "date",
  }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type DatabaseRow = typeof databases.$inferSelect
export type DatabaseInsert = typeof databases.$inferInsert
