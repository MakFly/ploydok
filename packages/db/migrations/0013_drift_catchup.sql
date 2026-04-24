-- Drift catch-up: brings the live DB in line with TS schema columns that
-- were added in code without ever being migrated. Idempotent (IF NOT EXISTS)
-- because some dev DBs already carry these columns from manual ALTERs.
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "nixpacks_config_path" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "node_version" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "runtime_port" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "exposure_mode" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "public_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "public_port" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "public_host" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "public_url" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "last_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN IF NOT EXISTS "phase" text DEFAULT 'runtime' NOT NULL;
