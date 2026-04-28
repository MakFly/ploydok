-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_instance_admin" boolean NOT NULL DEFAULT false;

WITH first_user AS (
  SELECT id
  FROM "users"
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
UPDATE "users"
SET "is_instance_admin" = true
WHERE id IN (SELECT id FROM first_user)
  AND NOT EXISTS (
    SELECT 1
    FROM "users"
    WHERE "is_instance_admin" = true
  );
