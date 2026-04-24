CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" text,
	"status" text DEFAULT 'created',
	"compose_raw" text NOT NULL,
	"generated_env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"domain" text,
	"container_ids" text[],
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;