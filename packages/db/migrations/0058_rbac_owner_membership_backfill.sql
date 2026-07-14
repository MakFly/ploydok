-- RBAC v1: guarantee every project (org) has at least one active owner membership.
-- `memberships` is the single source of truth for authorization; `projects.owner_id`
-- is kept only as an informational "creator" field and is NEVER updated when a
-- member is removed or ownership is transferred.
--
-- IMPORTANT: only orgs that currently have ZERO accepted owners are repaired.
-- We must NOT re-grant owner_id's membership just because their row is absent —
-- that would silently resurrect an owner who was intentionally removed from an
-- org that still has other owners. Both steps below are guarded on
-- "no accepted owner exists for this org".
-- Idempotent: safe to re-run.

-- 1. Orphan orgs (no accepted owner) where owner_id has no membership row at all:
--    seed owner_id as the accepted owner. This targets legacy orgs created
--    before the memberships table existed.
INSERT INTO "memberships" ("id", "org_id", "user_id", "role", "invited_at", "accepted_at")
SELECT gen_random_uuid()::text, p."id", p."owner_id", 'owner', p."created_at", p."created_at"
FROM "projects" AS p
WHERE NOT EXISTS (
  SELECT 1 FROM "memberships" AS owned
  WHERE owned."org_id" = p."id"
    AND owned."role" = 'owner'
    AND owned."accepted_at" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "memberships" AS existing
  WHERE existing."org_id" = p."id" AND existing."user_id" = p."owner_id"
)
ON CONFLICT ("org_id", "user_id") DO NOTHING;
--> statement-breakpoint

-- 2. Orphan orgs (no accepted owner) where owner_id DOES have a membership row
--    (e.g. a stale unaccepted or non-owner row): promote it to an accepted owner
--    so the ">= 1 accepted owner" invariant holds. Still guarded on "no accepted
--    owner", so an org that already has another owner is left untouched.
UPDATE "memberships" AS m
SET "role" = 'owner', "accepted_at" = COALESCE(m."accepted_at", p."created_at")
FROM "projects" AS p
WHERE m."org_id" = p."id"
  AND m."user_id" = p."owner_id"
  AND NOT EXISTS (
    SELECT 1 FROM "memberships" AS owned
    WHERE owned."org_id" = p."id"
      AND owned."role" = 'owner'
      AND owned."accepted_at" IS NOT NULL
  );
