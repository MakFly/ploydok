CREATE INDEX IF NOT EXISTS "backup_configs_database_id_idx"
  ON "backup_configs" ("database_id");

CREATE INDEX IF NOT EXISTS "app_db_links_database_id_app_id_env_prefix_idx"
  ON "app_db_links" ("database_id", "app_id", "env_prefix");
