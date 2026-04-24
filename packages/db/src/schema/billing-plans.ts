// SPDX-License-Identifier: AGPL-3.0-only
// TODO(lead): add seed to migration SQL - INSERT INTO billing_plans (slug, name, display_order, price_monthly_cents, features, quotas)
// VALUES
//   ('free',       'Free',       0,     0,  '{"sso":false,"whitelabel":false,"caddy_override":false,"audit_logs":true,"s3_backups":true}'::jsonb, '{"apps_count":3,"services_count":3,"members_count":3}'::jsonb),
//   ('pro',        'Pro',        10,    2900, '{"sso":false,"whitelabel":false,"caddy_override":true,"audit_logs":true,"s3_backups":true}'::jsonb,  '{"apps_count":0,"services_count":0,"members_count":10}'::jsonb),
//   ('enterprise', 'Enterprise', 20,    9900, '{"sso":true,"whitelabel":true,"caddy_override":true,"audit_logs":true,"s3_backups":true}'::jsonb,    '{"apps_count":0,"services_count":0,"members_count":0}'::jsonb)
// ON CONFLICT (slug) DO NOTHING;
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core"

export const billing_plans = pgTable("billing_plans", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  display_order: integer("display_order").notNull(),
  price_monthly_cents: integer("price_monthly_cents").notNull(),
  features: jsonb("features").notNull(),
  quotas: jsonb("quotas").notNull(),
  is_public: boolean("is_public").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
})

export type BillingPlanRow = typeof billing_plans.$inferSelect
export type BillingPlanInsert = typeof billing_plans.$inferInsert
