CREATE TABLE "backup_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
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
CREATE TABLE "backups" (
	"id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
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
CREATE TABLE "password_history" (
	"id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
	"password_enc" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "post_deploy_error" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "rotation_in_progress" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_configs" ADD CONSTRAINT "backup_configs_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_configs" ADD CONSTRAINT "backup_configs_s3_credentials_secret_id_secrets_id_fk" FOREIGN KEY ("s3_credentials_secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_config_id_backup_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."backup_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;