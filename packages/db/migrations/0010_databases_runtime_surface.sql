ALTER TABLE "databases" ADD COLUMN "version" text DEFAULT '' NOT NULL;
ALTER TABLE "databases" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;
ALTER TABLE "databases" ADD COLUMN "exposure_mode" text DEFAULT 'internal' NOT NULL;
ALTER TABLE "databases" ADD COLUMN "public_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "databases" ADD COLUMN "public_port" integer;
ALTER TABLE "databases" ADD COLUMN "public_host" text;
ALTER TABLE "databases" ADD COLUMN "public_url" text;
ALTER TABLE "databases" ADD COLUMN "last_started_at" timestamp with time zone;

UPDATE "databases"
SET
  "version" = CASE "kind"
    WHEN 'postgres' THEN '16'
    WHEN 'redis' THEN '7'
    WHEN 'mongo' THEN '7'
    ELSE ''
  END,
  "health_status" = CASE "status"
    WHEN 'running' THEN 'healthy'
    WHEN 'failed' THEN 'unhealthy'
    ELSE 'unknown'
  END;
