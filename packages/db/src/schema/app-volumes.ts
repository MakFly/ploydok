// SPDX-License-Identifier: AGPL-3.0-only
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { apps } from "./apps"

export const app_volumes = pgTable(
  "app_volumes",
  {
    id: text("id").primaryKey(),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mount_path: text("mount_path").notNull(),
    size_limit_bytes: bigint("size_limit_bytes", { mode: "number" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("app_volumes_app_idx").on(table.app_id),
    uniqueIndex("app_volumes_app_name_idx").on(table.app_id, table.name),
    uniqueIndex("app_volumes_app_mount_path_idx").on(
      table.app_id,
      table.mount_path
    ),
  ]
)

export type AppVolumeRow = typeof app_volumes.$inferSelect
export type AppVolumeInsert = typeof app_volumes.$inferInsert
