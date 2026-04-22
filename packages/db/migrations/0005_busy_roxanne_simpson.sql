ALTER TABLE "domains" ADD COLUMN "tls_mode" text DEFAULT 'http01' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns01_provider" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verify_token" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verify_error" text;