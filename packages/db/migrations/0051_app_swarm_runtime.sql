ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "runtime_mode" text DEFAULT 'swarm' NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "swarm_service_name" text;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "replicas" integer DEFAULT 1 NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "update_order" text DEFAULT 'start-first' NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "update_parallelism" integer DEFAULT 1 NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "update_delay_s" integer DEFAULT 10 NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "update_monitor_s" integer DEFAULT 30 NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "failure_action" text DEFAULT 'rollback' NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "stop_grace_period_s" integer DEFAULT 10 NOT NULL;
ALTER TABLE "builds" ADD COLUMN IF NOT EXISTS "runtime_ref" text;

UPDATE "apps"
SET "runtime_mode" = 'docker'
WHERE "build_method" IS DISTINCT FROM 'static'
  AND "container_id" IS NOT NULL
  AND "swarm_service_name" IS NULL;

UPDATE "apps"
SET "runtime_mode" = 'swarm'
WHERE "build_method" IS DISTINCT FROM 'static'
  AND "container_id" IS NULL;
