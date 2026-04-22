-- Wave 5: deploy hooks post_deploy_error column + succeeded_with_warning status
-- Note: PostgreSQL text enum is stored as plain text with no DB-level constraint
-- so we only need to add the new column.
ALTER TABLE "builds" ADD COLUMN "post_deploy_error" text;--> statement-breakpoint

-- Wave 5: password_history table for DB password rotation double-write window
CREATE TABLE "password_history" (
  "id" text PRIMARY KEY NOT NULL,
  "database_id" text NOT NULL,
  "password_enc" "bytea" NOT NULL,
  "nonce" "bytea" NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_database_id_databases_id_fk"
  FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Wave 5: rotation_in_progress lock column on databases
ALTER TABLE "databases" ADD COLUMN "rotation_in_progress" boolean DEFAULT false NOT NULL;
