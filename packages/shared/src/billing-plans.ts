// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

/**
 * Feature keys available across billing plans.
 */
export const FeatureKeySchema = z.enum([
  "sso",
  "whitelabel",
  "caddy_override",
  "audit_logs",
  "s3_backups",
])

export type FeatureKey = z.infer<typeof FeatureKeySchema>

/**
 * Quota keys available across billing plans.
 * Value 0 means unlimited.
 */
export const QuotaKeySchema = z.enum([
  "apps_count",
  "services_count",
  "members_count",
])

export type QuotaKey = z.infer<typeof QuotaKeySchema>

/**
 * Features map: feature key → enabled boolean.
 */
export const FeaturesSchema = z.record(FeatureKeySchema, z.boolean())

export type Features = z.infer<typeof FeaturesSchema>

/**
 * Quotas map: quota key → limit (0 = unlimited).
 */
export const QuotasSchema = z.record(
  QuotaKeySchema,
  z.number().int().nonnegative()
)

export type Quotas = z.infer<typeof QuotasSchema>

/**
 * Billing plan definition.
 */
export const BillingPlanSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  display_order: z.number().int(),
  price_monthly_cents: z.number().int().nonnegative(),
  features: FeaturesSchema,
  quotas: QuotasSchema,
  is_public: z.boolean().default(true),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
})

export type BillingPlan = z.infer<typeof BillingPlanSchema>

/**
 * Organization subscription status.
 */
export const SubscriptionStatusSchema = z.enum([
  "active",
  "trialing",
  "past_due",
  "canceled",
])

export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>

/**
 * Organization subscription.
 */
export const OrgSubscriptionSchema = z.object({
  id: z.string().min(1),
  org_id: z.string().min(1),
  plan_slug: z.string().min(1),
  status: SubscriptionStatusSchema,
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  trial_ends_at: z.coerce.date().nullable(),
  current_period_end: z.coerce.date().nullable(),
  cancel_at_period_end: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
})

export type OrgSubscription = z.infer<typeof OrgSubscriptionSchema>

/**
 * Checkout request body.
 */
export const CheckoutBodySchema = z.object({
  planSlug: z.enum(["pro", "enterprise"]),
})
export type CheckoutBody = z.infer<typeof CheckoutBodySchema>

/**
 * Checkout response with Stripe session URL.
 */
export const CheckoutResponseSchema = z.object({
  url: z.string().url(),
})
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>

/**
 * Billing portal response with Stripe portal URL.
 */
export const PortalResponseSchema = z.object({
  url: z.string().url(),
})
export type PortalResponse = z.infer<typeof PortalResponseSchema>

/**
 * Current plan response with plan and subscription details.
 */
export const CurrentPlanResponseSchema = z.object({
  plan: BillingPlanSchema,
  subscription: OrgSubscriptionSchema,
})
export type CurrentPlanResponse = z.infer<typeof CurrentPlanResponseSchema>
