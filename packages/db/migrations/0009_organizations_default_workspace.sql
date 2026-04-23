ALTER TABLE "projects" ADD COLUMN "is_default" boolean NOT NULL DEFAULT false;--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "owner_id" ORDER BY "created_at" ASC, "id" ASC) AS "rn"
  FROM "projects"
)
UPDATE "projects"
SET "is_default" = true
FROM ranked
WHERE "projects"."id" = ranked."id"
  AND ranked."rn" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_default_unique" ON "projects" ("owner_id") WHERE "is_default" = true;
