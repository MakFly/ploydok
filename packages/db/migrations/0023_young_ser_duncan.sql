CREATE TABLE "instance_license" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"plan" text NOT NULL,
	"seats" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by" text,
	"jwt" text NOT NULL,
	CONSTRAINT "instance_license_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "org_branding" (
	"org_id" text PRIMARY KEY NOT NULL,
	"app_name" text DEFAULT 'Ploydok' NOT NULL,
	"logo_url" text,
	"primary_color" text,
	"favicon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" "bytea" NOT NULL,
	"client_secret_nonce" "bytea" NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text DEFAULT 'openid email profile' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sso_configs_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "instance_license" ADD CONSTRAINT "instance_license_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_branding" ADD CONSTRAINT "org_branding_org_id_projects_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_configs" ADD CONSTRAINT "sso_configs_org_id_projects_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_configs_org_id_idx" ON "sso_configs" USING btree ("org_id");