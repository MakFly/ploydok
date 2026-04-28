ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "static_output_dir" text NOT NULL DEFAULT 'dist';
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "static_spa_fallback" boolean NOT NULL DEFAULT true;
