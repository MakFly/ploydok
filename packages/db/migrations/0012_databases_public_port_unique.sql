CREATE UNIQUE INDEX IF NOT EXISTS "databases_public_port_unique"
  ON "databases" ("public_port")
  WHERE "public_port" IS NOT NULL;
