ALTER TABLE "api_tokens" ADD COLUMN "scopes" jsonb DEFAULT '["admin:*"]'::jsonb NOT NULL;
