ALTER TABLE builds
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by_user_id text REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app_deploy_leases (
  app_id text PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  build_id text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  lease_token text NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_deploy_leases_until_idx
  ON app_deploy_leases (lease_until);
