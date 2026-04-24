// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  timestamp,
  customType,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea"
  },
})

/**
 * OIDC SSO configuration per organization.
 * Encrypted client_secret uses AES-256-GCM (keyring); nonce stored alongside.
 * Only one config per org (unique org_id).
 */
export const sso_configs = pgTable(
  "sso_configs",
  {
    id: text("id").primaryKey(), // nanoid
    org_id: text("org_id")
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    client_id: text("client_id").notNull(),
    client_secret_enc: bytea("client_secret_enc").notNull(),
    client_secret_nonce: bytea("client_secret_nonce").notNull(),
    redirect_uri: text("redirect_uri").notNull(),
    scopes: text("scopes").notNull().default("openid email profile"),
    enabled: boolean("enabled").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    orgIdIdx: uniqueIndex("sso_configs_org_id_idx").on(table.org_id),
  })
)

export type SSOConfigRow = typeof sso_configs.$inferSelect
export type SSOConfigInsert = typeof sso_configs.$inferInsert
