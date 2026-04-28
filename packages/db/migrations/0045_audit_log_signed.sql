ALTER TABLE "audit_log" ADD COLUMN "signature" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "key_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_anchors" (
	"id" serial PRIMARY KEY NOT NULL,
	"head_audit_id" integer NOT NULL,
	"head_hash" text NOT NULL,
	"signature" text NOT NULL,
	"key_id" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_audit_anchors_signed_at" ON "audit_anchors" ("signed_at");
