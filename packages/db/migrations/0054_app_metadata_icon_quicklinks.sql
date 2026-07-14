-- Per-app dashboard metadata (cosmetic): theme-aware icon URL + quick links.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-apply / repair drift.
ALTER TABLE "apps"
  ADD COLUMN IF NOT EXISTS "icon_url" text,
  ADD COLUMN IF NOT EXISTS "quick_links" text;
