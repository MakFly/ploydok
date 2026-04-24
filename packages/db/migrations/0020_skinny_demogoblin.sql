ALTER TABLE "apps" ADD COLUMN "caddy_extra_handlers" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "org_id" text;--> statement-breakpoint
CREATE INDEX "idx_audit_log_org_created" ON "audit_log" USING btree ("org_id","created_at");