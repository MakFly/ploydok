-- Repair objects from migrations 0028-0035 for databases where their journal
-- timestamps were older than an already-applied migration and Drizzle skipped
-- them. This migration reflects the final state after 0033 (app delete jobs
-- deliberately retain app_id after the app row is deleted).
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
CREATE TABLE IF NOT EXISTS "system_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by_user_id" text,
  "source" text DEFAULT 'api' NOT NULL,
  "options" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "queued_at" timestamp with time zone NOT NULL,
  "claimed_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error_message" text
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN IF NOT EXISTS "last_sync_status" text DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "requested_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'api' NOT NULL;
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "builds" SET "queued_at" = "created_at" WHERE "queued_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "builds" ALTER COLUMN "queued_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "requested_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "verify_source" text;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "verify_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "require_totp_for_secret_reveal" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "static_output_dir" text DEFAULT 'dist' NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "static_spa_fallback" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_mode" text DEFAULT 'off' NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_cache_ttl_s" integer DEFAULT 300;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_cache_paths" text[];
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_compression" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_image_optim" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_headers" text;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_external_provider" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_delete_jobs_app_id_status_idx" ON "app_delete_jobs" ("app_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_delete_jobs_status_idx" ON "app_delete_jobs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_jobs_kind_status_idx" ON "system_jobs" ("kind", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_jobs_status_idx" ON "system_jobs" ("status");
--> statement-breakpoint
ALTER TABLE "app_delete_jobs" DROP CONSTRAINT IF EXISTS "app_delete_jobs_app_id_apps_id_fk";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_delete_jobs"
    ADD CONSTRAINT "app_delete_jobs_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_credentials"
    ADD CONSTRAINT "provider_credentials_last_sync_actor_user_id_users_id_fk"
    FOREIGN KEY ("last_sync_actor_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "system_jobs"
    ADD CONSTRAINT "system_jobs_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "builds"
    ADD CONSTRAINT "builds_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "domains"
    ADD CONSTRAINT "domains_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
