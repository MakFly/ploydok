ALTER TABLE "apps"
  ADD COLUMN IF NOT EXISTS "creation_idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "databases"
  ADD COLUMN IF NOT EXISTS "creation_idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "apps_project_creation_idempotency_key_unique"
  ON "apps" ("project_id", "creation_idempotency_key")
  WHERE "creation_idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "databases_project_creation_idempotency_key_unique"
  ON "databases" ("project_id", "creation_idempotency_key")
  WHERE "creation_idempotency_key" IS NOT NULL;
