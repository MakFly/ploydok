ALTER TABLE "apps" ADD COLUMN "recipe_id" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "recipe_version" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "recipe_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "recipe_version" text;