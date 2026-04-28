// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core"
import { apps } from "./apps"

export const app_manifests = pgTable(
  "app_manifests",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["platform", "app"] }).notNull(),
    app_id: text("app_id").references(() => apps.id, { onDelete: "cascade" }),
    target_id: text("target_id").notNull(),
    ecosystem: text("ecosystem").notNull(),
    manifest_path: text("manifest_path").notNull(),
    content_hash: text("content_hash").notNull(),
    dependencies: jsonb("dependencies").$type<unknown>().notNull(),
    captured_at: timestamp("captured_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("app_manifests_target_path_hash_idx").on(
      t.scope,
      t.target_id,
      t.manifest_path,
      t.content_hash
    ),
    index("app_manifests_scope_idx").on(t.scope),
    index("app_manifests_app_id_idx").on(t.app_id),
  ]
)

export type AppManifestRow = typeof app_manifests.$inferSelect
export type AppManifestInsert = typeof app_manifests.$inferInsert
