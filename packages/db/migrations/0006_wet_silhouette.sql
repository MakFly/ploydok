CREATE TABLE "app_db_links" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"database_id" text NOT NULL,
	"env_prefix" text DEFAULT 'DATABASE' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "databases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"plan" text NOT NULL,
	"container_id" text,
	"volume_name" text NOT NULL,
	"connection_string_enc" "bytea",
	"connection_string_nonce" "bytea",
	"master_password_enc" "bytea",
	"master_password_nonce" "bytea",
	"status" text DEFAULT 'creating' NOT NULL,
	"host" text,
	"port" integer,
	"rotation_schedule" text DEFAULT 'manual' NOT NULL,
	"password_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"domain" text NOT NULL,
	"cert_enc" "bytea",
	"cert_nonce" "bytea",
	"key_enc" "bytea",
	"key_nonce" "bytea",
	"not_before" timestamp with time zone,
	"not_after" timestamp with time zone,
	"last_alert_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_basic_auth_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_basic_auth_user_enc" "bytea";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_basic_auth_user_nonce" "bytea";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_basic_auth_pass_enc" "bytea";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_basic_auth_pass_nonce" "bytea";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_ip_allowlist" text[];--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "protection_rate_limit_rps" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "hooks_pre_deploy" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "hooks_post_deploy" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "hooks_timeout_s" integer DEFAULT 300;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "linked_database_id" text;--> statement-breakpoint
ALTER TABLE "app_db_links" ADD CONSTRAINT "app_db_links_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db_links" ADD CONSTRAINT "app_db_links_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_certificates" ADD CONSTRAINT "tls_certificates_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_db_links_unique" ON "app_db_links" USING btree ("app_id","database_id","env_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "tls_certificates_app_domain_idx" ON "tls_certificates" USING btree ("app_id","domain");--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_linked_database_id_databases_id_fk" FOREIGN KEY ("linked_database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;