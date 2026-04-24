CREATE TABLE "membership_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_invitations_org_id_email_accepted_at_unique" UNIQUE("org_id","email","accepted_at")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "memberships_org_id_user_id_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_org_id_projects_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_projects_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_invitations_org_id_idx" ON "membership_invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "membership_invitations_token_hash_idx" ON "membership_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "memberships_org_id_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
-- Seed: existing projects become owner memberships for their current owner_id.
-- Uses gen_random_uuid() (Postgres 13+, built-in) for the id since nanoid()
-- is application-side. The id format differs from nanoid in the app, but that
-- is harmless — ids are opaque text. ON CONFLICT shields against re-runs.
INSERT INTO memberships (id, org_id, user_id, role, invited_at, accepted_at)
SELECT gen_random_uuid()::text, id, owner_id, 'owner', created_at, created_at
FROM projects
ON CONFLICT (org_id, user_id) DO NOTHING;
