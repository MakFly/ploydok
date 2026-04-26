CREATE TABLE "system_jobs" (
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
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_jobs_kind_status_idx" ON "system_jobs" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "system_jobs_status_idx" ON "system_jobs" USING btree ("status");