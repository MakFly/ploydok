-- Keep the newest in-flight row when an older deployment already created
-- duplicate `running` rows for the same job. Without this repair, creating the
-- partial unique index would abort the entire production migration.
WITH ranked_running AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "job_id"
      ORDER BY "started_at" DESC, "id" DESC
    ) AS "run_rank"
  FROM "scheduled_job_runs"
  WHERE "status" = 'running'
)
UPDATE "scheduled_job_runs" AS runs
SET
  "status" = 'timeout',
  "finished_at" = COALESCE(runs."finished_at", now()),
  "error" = COALESCE(
    runs."error",
    'Superseded while repairing duplicate running scheduled jobs'
  )
FROM ranked_running
WHERE runs."id" = ranked_running."id"
  AND ranked_running."run_rank" > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_job_runs_one_running_per_job_idx"
  ON "scheduled_job_runs" ("job_id")
  WHERE "status" = 'running';
