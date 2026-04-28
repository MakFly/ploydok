DROP TABLE IF EXISTS "instance_license";
--> statement-breakpoint
UPDATE "billing_plans"
SET "features" = "features" - 'custom_license'
WHERE "features" ? 'custom_license';
