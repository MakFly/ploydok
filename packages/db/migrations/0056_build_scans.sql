-- Trivy image vulnerability scan results, one row per build scan.
-- Idempotent so it is safe to re-apply / repair drift.
CREATE TABLE IF NOT EXISTS "build_scans" (
  "id" text PRIMARY KEY NOT NULL,
  "build_id" text NOT NULL,
  "image_ref" text,
  "scanner" text DEFAULT 'trivy' NOT NULL,
  "status" text DEFAULT 'ok' NOT NULL,
  "critical" integer DEFAULT 0 NOT NULL,
  "high" integer DEFAULT 0 NOT NULL,
  "medium" integer DEFAULT 0 NOT NULL,
  "low" integer DEFAULT 0 NOT NULL,
  "unknown" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "scanned_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "build_scans" ADD CONSTRAINT "build_scans_build_id_builds_id_fk"
    FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_scans_build_id_idx" ON "build_scans" ("build_id");
