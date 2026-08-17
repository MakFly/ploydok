CREATE INDEX IF NOT EXISTS "backups_database_id_started_at_id_idx"
  ON "backups" ("database_id", "started_at" DESC, "id" DESC);
