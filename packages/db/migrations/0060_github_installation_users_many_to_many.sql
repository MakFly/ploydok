-- A GitHub organization installation may be deliberately connected by more
-- than one Ploydok user. Preserve every signed association; never transfer it.
ALTER TABLE "github_installation_users"
  DROP CONSTRAINT IF EXISTS "github_installation_users_pkey";
--> statement-breakpoint
ALTER TABLE "github_installation_users"
  ADD CONSTRAINT "github_installation_users_pkey"
  PRIMARY KEY ("installation_id", "user_id");
