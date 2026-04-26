CREATE TABLE IF NOT EXISTS "app_delete_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text,
	"source" text DEFAULT 'api' NOT NULL,
	"options" jsonb,
	"queued_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"credential_type" text NOT NULL,
	"last_sync_status" text DEFAULT 'pending',
	"last_sync_actor_user_id" text,
	"last_sync_source" text,
	"last_sync_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN IF NOT EXISTS "last_sync_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;--> statement-breakpoint
UPDATE "builds" SET "queued_at" = "created_at" WHERE "queued_at" IS NULL;--> statement-breakpoint
ALTER TABLE "builds" ALTER COLUMN "queued_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "verify_source" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "verify_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_delete_jobs_app_id_status_idx" ON "app_delete_jobs" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_delete_jobs_status_idx" ON "app_delete_jobs" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app_delete_jobs" ADD CONSTRAINT "app_delete_jobs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app_delete_jobs" ADD CONSTRAINT "app_delete_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_last_sync_actor_user_id_users_id_fk" FOREIGN KEY ("last_sync_actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "builds" ADD CONSTRAINT "builds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "domains" ADD CONSTRAINT "domains_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
