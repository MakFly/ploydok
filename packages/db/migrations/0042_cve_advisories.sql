CREATE TABLE IF NOT EXISTS "app_manifests" (
  "id" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "app_id" text,
  "target_id" text NOT NULL,
  "ecosystem" text NOT NULL,
  "manifest_path" text NOT NULL,
  "content_hash" text NOT NULL,
  "dependencies" jsonb NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cve_advisories" (
  "id" text PRIMARY KEY NOT NULL,
  "summary" text,
  "details" text,
  "aliases" text[],
  "severity_level" text DEFAULT 'UNKNOWN' NOT NULL,
  "severity_type" text,
  "severity_score" text,
  "references" jsonb NOT NULL,
  "raw" jsonb NOT NULL,
  "published_at" timestamp with time zone,
  "modified_at" timestamp with time zone,
  "withdrawn_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cve_matches" (
  "id" text PRIMARY KEY NOT NULL,
  "advisory_id" text NOT NULL,
  "scope" text NOT NULL,
  "app_id" text,
  "project_id" text,
  "ecosystem" text NOT NULL,
  "package_name" text NOT NULL,
  "current_version" text NOT NULL,
  "manifest_path" text NOT NULL,
  "severity_level" text DEFAULT 'UNKNOWN' NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "fixed_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" text,
  "acknowledged_note" text,
  "notified_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_manifests"
    ADD CONSTRAINT "app_manifests_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cve_matches"
    ADD CONSTRAINT "cve_matches_advisory_id_cve_advisories_id_fk"
    FOREIGN KEY ("advisory_id") REFERENCES "cve_advisories"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cve_matches"
    ADD CONSTRAINT "cve_matches_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cve_matches"
    ADD CONSTRAINT "cve_matches_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cve_matches"
    ADD CONSTRAINT "cve_matches_acknowledged_by_users_id_fk"
    FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_manifests_target_path_hash_idx"
  ON "app_manifests" ("scope", "target_id", "manifest_path", "content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_manifests_scope_idx" ON "app_manifests" ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_manifests_app_id_idx" ON "app_manifests" ("app_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cve_advisories_severity_idx" ON "cve_advisories" ("severity_level");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cve_advisories_modified_idx" ON "cve_advisories" ("modified_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cve_matches_scope_severity_idx"
  ON "cve_matches" ("scope", "severity_level", "acknowledged_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cve_matches_app_idx" ON "cve_matches" ("app_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cve_matches_project_idx" ON "cve_matches" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cve_matches_advisory_idx" ON "cve_matches" ("advisory_id");
