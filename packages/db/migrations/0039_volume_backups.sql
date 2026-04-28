CREATE TABLE "volume_backup_configs" (
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
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volume_backups" (
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
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "volume_backup_configs" ADD CONSTRAINT "volume_backup_configs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backup_configs" ADD CONSTRAINT "volume_backup_configs_volume_id_app_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."app_volumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backup_configs" ADD CONSTRAINT "volume_backup_configs_s3_credentials_secret_id_secrets_id_fk" FOREIGN KEY ("s3_credentials_secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backups" ADD CONSTRAINT "volume_backups_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backups" ADD CONSTRAINT "volume_backups_volume_id_app_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."app_volumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backups" ADD CONSTRAINT "volume_backups_config_id_volume_backup_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."volume_backup_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "volume_backup_configs_volume_idx" ON "volume_backup_configs" USING btree ("volume_id");--> statement-breakpoint
CREATE INDEX "volume_backups_app_volume_started_idx" ON "volume_backups" USING btree ("app_id","volume_id","started_at");--> statement-breakpoint
