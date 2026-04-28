ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "preview_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "preview_wildcard" text;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "preview_ttl_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "preview_deployments" (
  "id" text PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "pr_number" integer NOT NULL,
  "head_sha" text NOT NULL,
  "domain" text NOT NULL,
  "container_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "preview_deployments"
    ADD CONSTRAINT "preview_deployments_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "preview_deployments_app_pr_unique"
  ON "preview_deployments" ("app_id", "pr_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_deployments_app_idx"
  ON "preview_deployments" ("app_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_deployments_status_idx"
  ON "preview_deployments" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_volumes" (
  "id" text PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "name" text NOT NULL,
  "mount_path" text NOT NULL,
  "size_limit_bytes" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_volumes"
    ADD CONSTRAINT "app_volumes_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_volumes_app_idx"
  ON "app_volumes" ("app_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_volumes_app_name_idx"
  ON "app_volumes" ("app_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_volumes_app_mount_path_idx"
  ON "app_volumes" ("app_id", "mount_path");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volume_backup_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "volume_id" text NOT NULL,
  "destination_kind" text DEFAULT 'local' NOT NULL,
  "s3_endpoint" text,
  "s3_bucket" text,
  "s3_prefix" text,
  "s3_region" text,
  "s3_credentials_secret_id" text,
  "schedule_cron" text DEFAULT '0 3 * * *' NOT NULL,
  "retention_days" integer DEFAULT 7 NOT NULL,
  "age_recipient_public_key" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volume_backups" (
  "id" text PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "volume_id" text NOT NULL,
  "config_id" text,
  "destination_kind" text,
  "location" text NOT NULL,
  "size_bytes" bigint,
  "age_encrypted" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "volume_backup_configs"
    ADD CONSTRAINT "volume_backup_configs_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "volume_backup_configs"
    ADD CONSTRAINT "volume_backup_configs_volume_id_app_volumes_id_fk"
    FOREIGN KEY ("volume_id") REFERENCES "app_volumes"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "volume_backup_configs"
    ADD CONSTRAINT "volume_backup_configs_s3_credentials_secret_id_secrets_id_fk"
    FOREIGN KEY ("s3_credentials_secret_id") REFERENCES "secrets"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "volume_backups"
    ADD CONSTRAINT "volume_backups_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "volume_backups"
    ADD CONSTRAINT "volume_backups_volume_id_app_volumes_id_fk"
    FOREIGN KEY ("volume_id") REFERENCES "app_volumes"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "volume_backups"
    ADD CONSTRAINT "volume_backups_config_id_volume_backup_configs_id_fk"
    FOREIGN KEY ("config_id") REFERENCES "volume_backup_configs"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volume_backup_configs_volume_idx"
  ON "volume_backup_configs" ("volume_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "volume_backups_app_volume_started_idx"
  ON "volume_backups" ("app_id", "volume_id", "started_at");
