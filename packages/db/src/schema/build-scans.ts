// SPDX-License-Identifier: AGPL-3.0-only
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { builds } from "./builds"

// Trivy image vulnerability scan results — one row per build scan.
export const build_scans = pgTable(
  "build_scans",
  {
    id: text("id").primaryKey(),
    build_id: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    image_ref: text("image_ref"),
    scanner: text("scanner").notNull().default("trivy"),
    // Queue lifecycle plus terminal scan outcomes. Scans never gate deploys.
    status: text("status", {
      enum: ["pending", "running", "ok", "skipped", "failed"],
    })
      .notNull()
      .default("pending"),
    critical: integer("critical").notNull().default(0),
    high: integer("high").notNull().default(0),
    medium: integer("medium").notNull().default(0),
    low: integer("low").notNull().default(0),
    unknown: integer("unknown").notNull().default(0),
    error_message: text("error_message"),
    started_at: timestamp("started_at", { withTimezone: true, mode: "date" }),
    scanned_at: timestamp("scanned_at", { withTimezone: true, mode: "date" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("build_scans_build_id_uidx").on(t.build_id)]
)

export type BuildScanRow = typeof build_scans.$inferSelect
export type BuildScanInsert = typeof build_scans.$inferInsert
