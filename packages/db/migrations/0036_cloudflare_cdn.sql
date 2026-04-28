CREATE TABLE IF NOT EXISTS "cloudflare_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "label" text DEFAULT 'Cloudflare' NOT NULL,
  "account_id" text,
  "api_token_enc" bytea NOT NULL,
  "api_token_nonce" bytea NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_cloudflare_cdn" (
  "app_id" text PRIMARY KEY NOT NULL,
  "connection_id" text NOT NULL,
  "zone_id" text NOT NULL,
  "zone_name" text,
  "hostname" text NOT NULL,
  "origin" text NOT NULL,
  "dns_record_id" text,
  "ruleset_id" text,
  "ruleset_rule_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "last_sync_error" text,
  "synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cloudflare_connections"
    ADD CONSTRAINT "cloudflare_connections_org_id_projects_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "projects"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cloudflare_connections"
    ADD CONSTRAINT "cloudflare_connections_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_cloudflare_cdn"
    ADD CONSTRAINT "app_cloudflare_cdn_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_cloudflare_cdn"
    ADD CONSTRAINT "app_cloudflare_cdn_connection_id_cloudflare_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "cloudflare_connections"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cloudflare_connections_org_label_idx"
  ON "cloudflare_connections" ("org_id", "label");
