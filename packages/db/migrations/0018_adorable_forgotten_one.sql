-- Drop the "recipe" build method in favour of Nixpacks (like Dokploy / Coolify).
-- Any app still flagged as recipe is converted to nixpacks so the next deploy
-- picks up the same image without manual intervention.
UPDATE "apps" SET "build_method" = 'nixpacks' WHERE "build_method" = 'recipe';
UPDATE "builds" SET "build_method" = 'nixpacks' WHERE "build_method" = 'recipe';
--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "recipe_id";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "recipe_version";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "recipe_vars";--> statement-breakpoint
ALTER TABLE "builds" DROP COLUMN "recipe_id";--> statement-breakpoint
ALTER TABLE "builds" DROP COLUMN "recipe_version";