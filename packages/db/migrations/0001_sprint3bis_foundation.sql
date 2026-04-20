CREATE TABLE "gitlab_config" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_url" text DEFAULT 'https://gitlab.com' NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" "bytea" NOT NULL,
	"client_secret_nonce" "bytea" NOT NULL,
	"webhook_secret_enc" "bytea" NOT NULL,
	"webhook_secret_nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_tokens" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"access_token_nonce" "bytea" NOT NULL,
	"refresh_token_enc" "bytea",
	"refresh_token_nonce" "bytea",
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"max_apps_per_user" integer,
	"max_total_memory_mb" integer,
	"max_total_cpu_cores" integer,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"registry_host" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" "bytea" NOT NULL,
	"password_nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "gitlab_project_id" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "image_ref" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "image_pull_policy" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "registry_credential_id" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "track_latest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "plan" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "cpu_limit" real;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "mem_limit_bytes" bigint;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "pids_limit" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "network_name" text;--> statement-breakpoint
ALTER TABLE "gitlab_tokens" ADD CONSTRAINT "gitlab_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_credentials" ADD CONSTRAINT "registry_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_registry_credential_id_registry_credentials_id_fk" FOREIGN KEY ("registry_credential_id") REFERENCES "public"."registry_credentials"("id") ON DELETE set null ON UPDATE no action;