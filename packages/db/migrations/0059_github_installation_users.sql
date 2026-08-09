-- User-bound proof that a GitHub App installation completed the signed setup flow.
-- Idempotent for drift repair and safe to apply to already-provisioned instances.
CREATE TABLE IF NOT EXISTS "github_installation_users" (
  "installation_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "github_installation_users_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
