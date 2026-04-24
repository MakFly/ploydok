ALTER TABLE "apps" ADD COLUMN "nixpacks_config_path" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "node_version" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "runtime_port" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "exposure_mode" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "public_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "public_port" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "public_host" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "public_url" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "last_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "phase" text DEFAULT 'runtime' NOT NULL;