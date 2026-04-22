// SPDX-License-Identifier: AGPL-3.0-only
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { apps } from "./apps"

export const domains = pgTable(
  "domains",
  {
    id: text("id").primaryKey(),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    // TLS certificate lifecycle: pending → issued | failed
    tls_status: text("tls_status", { enum: ["pending", "issued", "failed"] })
      .notNull()
      .default("pending"),
    // TLS provisioning mode: http01 (default) or dns01 (wildcard support)
    tls_mode: text("tls_mode", { enum: ["http01", "dns01"] })
      .notNull()
      .default("http01"),
    // DNS-01 provider (cloudflare | route53 | ovh | digitalocean), null for http01
    dns01_provider: text("dns01_provider"),
    // Random hex token stored in _ploydok-verify.<hostname> TXT record
    verify_token: text("verify_token"),
    // Last verification error message
    verify_error: text("verify_error"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // A hostname must be globally unique — one hostname can only belong to one app.
    uniqueIndex("domains_hostname_unique").on(t.hostname),
    index("domains_app_id_idx").on(t.app_id),
  ],
)

export type DomainRow = typeof domains.$inferSelect
export type DomainInsert = typeof domains.$inferInsert
export type TlsMode = "http01" | "dns01"
export type Dns01Provider = "cloudflare" | "route53" | "ovh" | "digitalocean"
