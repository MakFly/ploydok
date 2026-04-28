ALTER TABLE "apps" ADD COLUMN "preview_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "preview_wildcard" text;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "preview_ttl_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
CREATE TABLE "preview_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"domain" text NOT NULL,
	"container_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preview_deployments" ADD CONSTRAINT "preview_deployments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "preview_deployments_app_pr_unique" ON "preview_deployments" USING btree ("app_id","pr_number");
--> statement-breakpoint
CREATE INDEX "preview_deployments_app_idx" ON "preview_deployments" USING btree ("app_id");
--> statement-breakpoint
CREATE INDEX "preview_deployments_status_idx" ON "preview_deployments" USING btree ("status");
