ALTER TABLE "apps" ADD COLUMN "nixpacks_config_path" text;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "node_version" text;
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "runtime_port" integer;
--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "phase" text DEFAULT 'runtime' NOT NULL;
