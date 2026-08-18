-- Remove the historical nullable uniqueness constraint. NULL semantics made it
-- ineffective for pending invitations; migration 0064 installs the real
-- case-insensitive partial unique index.
ALTER TABLE membership_invitations
  DROP CONSTRAINT IF EXISTS membership_invitations_org_id_email_accepted_at_unique;

CREATE TABLE IF NOT EXISTS outbox_events (
  id text PRIMARY KEY,
  topic text NOT NULL,
  payload_ciphertext bytea NOT NULL,
  payload_nonce bytea NOT NULL,
  available_at timestamp with time zone NOT NULL,
  lease_token text,
  lease_until timestamp with time zone,
  attempt_count integer NOT NULL DEFAULT 0,
  delivered_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (delivered_at, available_at);
