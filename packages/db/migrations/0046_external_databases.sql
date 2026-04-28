-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "databases"
  ADD COLUMN IF NOT EXISTS "management_mode" text NOT NULL DEFAULT 'managed';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "databases"
    ADD CONSTRAINT "databases_management_mode_check"
    CHECK ("management_mode" IN ('managed', 'external'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_databases_management_mode"
  ON "databases" ("management_mode");
