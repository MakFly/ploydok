ALTER TABLE "builds"
  ADD COLUMN IF NOT EXISTS "log_archive" text;
--> statement-breakpoint
ALTER TABLE "builds"
  ADD COLUMN IF NOT EXISTS "log_archive_raw_size" integer;
--> statement-breakpoint
ALTER TABLE "builds"
  ADD COLUMN IF NOT EXISTS "log_archive_compressed_size" integer;
--> statement-breakpoint
ALTER TABLE "builds"
  ADD COLUMN IF NOT EXISTS "log_archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "builds"
  ADD COLUMN IF NOT EXISTS "log_purged_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_finished_at_idx"
  ON "builds" ("finished_at");
