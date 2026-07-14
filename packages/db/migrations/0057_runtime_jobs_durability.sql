-- Durable state for image auto-updates, Trivy scans, and disk reclaim jobs.
-- Idempotent so it can safely repair a partially upgraded installation.
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "pending_image_digest" text;
--> statement-breakpoint
ALTER TABLE "build_scans" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "build_scans" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "system_jobs" ADD COLUMN IF NOT EXISTS "result" jsonb;
--> statement-breakpoint
DELETE FROM "build_scans" AS older
USING "build_scans" AS newer
WHERE older."build_id" = newer."build_id"
  AND (
    older."created_at" < newer."created_at"
    OR (older."created_at" = newer."created_at" AND older."id" < newer."id")
  );
--> statement-breakpoint
DROP INDEX IF EXISTS "build_scans_build_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "build_scans_build_id_uidx"
  ON "build_scans" ("build_id");
