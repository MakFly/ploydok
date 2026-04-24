// SPDX-License-Identifier: AGPL-3.0-only
// TODO(lead): add seed to migration SQL - INSERT INTO org_subscriptions (id, org_id, plan_slug, status, created_at, updated_at)
// SELECT nanoid(), id, 'free', 'active', created_at, created_at
// FROM projects
// ON CONFLICT (org_id) DO NOTHING;
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"
import { billing_plans } from "./billing-plans"

export const org_subscriptions = pgTable(
  "org_subscriptions",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    plan_slug: text("plan_slug")
      .notNull()
      .references(() => billing_plans.slug),
    status: text("status", {
      enum: ["active", "trialing", "past_due", "canceled"],
    })
      .notNull()
      .default("active"),
    stripe_customer_id: text("stripe_customer_id"),
    stripe_subscription_id: text("stripe_subscription_id"),
    trial_ends_at: timestamp("trial_ends_at", {
      withTimezone: true,
      mode: "date",
    }),
    current_period_end: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }),
    cancel_at_period_end: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.org_id),
    index("org_subscriptions_org_id_idx").on(table.org_id),
    index("org_subscriptions_plan_slug_idx").on(table.plan_slug),
  ]
)

export type OrgSubscriptionRow = typeof org_subscriptions.$inferSelect
export type OrgSubscriptionInsert = typeof org_subscriptions.$inferInsert
