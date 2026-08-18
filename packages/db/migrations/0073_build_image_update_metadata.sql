ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "image_update_from_digest" text;
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "image_update_to_digest" text;
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "image_update_previous_status" text;
