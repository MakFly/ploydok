ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "rotated_at" timestamp with time zone;
