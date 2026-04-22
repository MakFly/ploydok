CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text,
	"provider" text NOT NULL,
	"delivery_external_id" text,
	"event" text NOT NULL,
	"ref" text,
	"commit_sha" text,
	"commit_message" text,
	"signature_valid" boolean NOT NULL,
	"decision" text NOT NULL,
	"decision_reason" text,
	"build_id" text,
	"payload_hash" text NOT NULL,
	"payload_sample" jsonb,
	"payload_raw" "bytea",
	"payload_raw_expires_at" timestamp with time zone,
	"payload_truncated" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'webhook' NOT NULL,
	"parent_delivery_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "auto_deploy_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "post_commit_status" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "coalesce_pushes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "deploy_on_tag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "tag_pattern" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "webhook_secret" "bytea";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "webhook_secret_old" "bytea";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "webhook_secret_old_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wh_del_app_received_idx" ON "webhook_deliveries" USING btree ("app_id","received_at");--> statement-breakpoint
CREATE INDEX "wh_del_payload_hash_idx" ON "webhook_deliveries" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "wh_del_parent_delivery_idx" ON "webhook_deliveries" USING btree ("parent_delivery_id");