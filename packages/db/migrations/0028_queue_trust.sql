CREATE TABLE "app_delete_jobs" (
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
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"credential_type" text NOT NULL,
	"last_sync_actor_user_id" text,
	"last_sync_source" text,
	"last_sync_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "source" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "queued_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verify_source" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verify_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_delete_jobs" ADD CONSTRAINT "app_delete_jobs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_delete_jobs" ADD CONSTRAINT "app_delete_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_last_sync_actor_user_id_users_id_fk" FOREIGN KEY ("last_sync_actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_delete_jobs_app_id_status_idx" ON "app_delete_jobs" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "app_delete_jobs_status_idx" ON "app_delete_jobs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;