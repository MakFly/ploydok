-- Drift repair and autonomous execution metadata for JOB-04 creation sagas.
ALTER TABLE resource_creation_sagas
  ADD COLUMN IF NOT EXISTS input_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS input_nonce bytea,
  ADD COLUMN IF NOT EXISTS input_digest text,
  ADD COLUMN IF NOT EXISTS lease_token text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8;

ALTER TABLE resource_creation_sagas
  DROP CONSTRAINT IF EXISTS resource_creation_sagas_state_check;

ALTER TABLE resource_creation_sagas
  ADD CONSTRAINT resource_creation_sagas_state_check
    CHECK (state IN ('initializing', 'provisioning', 'compensating', 'failed', 'complete', 'compensated')),
  ADD CONSTRAINT resource_creation_sagas_max_attempts_check
    CHECK (max_attempts > 0);

CREATE INDEX IF NOT EXISTS resource_creation_sagas_retry_idx
  ON resource_creation_sagas (next_retry_at, created_at)
  WHERE state NOT IN ('complete', 'compensated');
