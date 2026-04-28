CREATE TABLE IF NOT EXISTS "app_volumes" (
  "id" text PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "name" text NOT NULL,
  "mount_path" text NOT NULL,
  "size_limit_bytes" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_volumes"
    ADD CONSTRAINT "app_volumes_app_id_apps_id_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_volumes_app_idx"
  ON "app_volumes" ("app_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_volumes_app_name_idx"
  ON "app_volumes" ("app_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_volumes_app_mount_path_idx"
  ON "app_volumes" ("app_id", "mount_path");
