-- Track the last-observed registry manifest digest for image apps.
-- Used by the image auto-update watch to detect when a tracked tag has moved.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-apply / repair drift.
ALTER TABLE "apps"
  ADD COLUMN IF NOT EXISTS "last_image_digest" text;
