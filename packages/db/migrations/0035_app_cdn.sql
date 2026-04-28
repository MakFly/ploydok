ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_mode" text NOT NULL DEFAULT 'off';
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_cache_ttl_s" integer DEFAULT 300;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_cache_paths" text[];
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_compression" boolean NOT NULL DEFAULT false;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_image_optim" boolean NOT NULL DEFAULT false;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_headers" text;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "cdn_external_provider" text;
