CREATE TABLE "provider_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text,
	"repository_selection" text,
	"suspended_at" timestamp with time zone,
	"html_url" text,
	"avatar_url" text,
	"repository_count" integer,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_provider_installations_provider_external_id" UNIQUE("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "provider_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"provider" text NOT NULL,
	"full_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_branch" text,
	"private" boolean DEFAULT false NOT NULL,
	"html_url" text,
	"pushed_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_repos" ADD CONSTRAINT "provider_repos_installation_id_provider_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."provider_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_provider_repos_install" ON "provider_repos" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "idx_provider_repos_fullname" ON "provider_repos" USING btree ("provider","full_name");--> statement-breakpoint
CREATE INDEX "idx_provider_repos_search" ON "provider_repos" USING btree ("full_name");