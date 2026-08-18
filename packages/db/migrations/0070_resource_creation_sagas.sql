-- Durable, resumable creation state for applications and managed databases.
CREATE TABLE IF NOT EXISTS resource_creation_sagas (
  id text PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'initializing',
  completed_steps text[] NOT NULL DEFAULT ARRAY[]::text[],
  owned_resources jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT resource_creation_sagas_resource_type_check
    CHECK (resource_type IN ('application', 'database')),
  CONSTRAINT resource_creation_sagas_state_check
    CHECK (state IN ('initializing', 'provisioning', 'compensating', 'failed', 'complete')),
  CONSTRAINT resource_creation_sagas_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT resource_creation_sagas_resource_unique UNIQUE (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS resource_creation_sagas_incomplete_idx
  ON resource_creation_sagas (state, updated_at)
  WHERE state <> 'complete';
