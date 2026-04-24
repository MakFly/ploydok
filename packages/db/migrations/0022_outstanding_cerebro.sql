CREATE TABLE "billing_plans" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"price_monthly_cents" integer NOT NULL,
	"features" jsonb NOT NULL,
	"quotas" jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan_slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_subscriptions_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_projects_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_slug_billing_plans_slug_fk" FOREIGN KEY ("plan_slug") REFERENCES "public"."billing_plans"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_subscriptions_org_id_idx" ON "org_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_subscriptions_plan_slug_idx" ON "org_subscriptions" USING btree ("plan_slug");--> statement-breakpoint
-- Seed the three billing plans. Feature/quota keys match packages/shared/src/billing-plans.ts enums.
-- 0 in quotas = unlimited (convention, see BillingPlanSchema).
INSERT INTO billing_plans (slug, name, display_order, price_monthly_cents, features, quotas)
VALUES
  ('free',       'Free',       0,     0,    '{"sso":false,"whitelabel":false,"caddy_override":false,"audit_logs":true,"s3_backups":true,"custom_license":false}'::jsonb, '{"apps_count":3,"services_count":3,"members_count":3}'::jsonb),
  ('pro',        'Pro',        10,    2900, '{"sso":false,"whitelabel":false,"caddy_override":true,"audit_logs":true,"s3_backups":true,"custom_license":false}'::jsonb,  '{"apps_count":0,"services_count":0,"members_count":10}'::jsonb),
  ('enterprise', 'Enterprise', 20,    9900, '{"sso":true,"whitelabel":true,"caddy_override":true,"audit_logs":true,"s3_backups":true,"custom_license":true}'::jsonb,    '{"apps_count":0,"services_count":0,"members_count":0}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
-- Seed: every existing project gets a free-tier subscription. Idempotent.
INSERT INTO org_subscriptions (id, org_id, plan_slug, status, created_at, updated_at)
SELECT gen_random_uuid()::text, id, 'free', 'active', created_at, created_at
FROM projects
ON CONFLICT (org_id) DO NOTHING;
