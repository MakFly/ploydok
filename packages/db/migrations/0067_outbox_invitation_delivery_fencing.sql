-- Additive drift repair for installations where 0065 has already run.
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS invitation_id text,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamp with time zone;

DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'outbox_events'::regclass
    AND conname = 'outbox_events_invitation_id_unique';

  IF definition IS NOT NULL AND definition <> 'UNIQUE (invitation_id)' THEN
    ALTER TABLE outbox_events
      DROP CONSTRAINT outbox_events_invitation_id_unique;
    definition := NULL;
  END IF;
  IF definition IS NULL THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_invitation_id_unique UNIQUE (invitation_id);
  END IF;
END $$;

DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'outbox_events'::regclass
    AND conname = 'outbox_events_invitation_id_fkey';

  IF definition IS NOT NULL AND definition <>
    'FOREIGN KEY (invitation_id) REFERENCES membership_invitations(id) ON DELETE CASCADE'
  THEN
    ALTER TABLE outbox_events
      DROP CONSTRAINT outbox_events_invitation_id_fkey;
    definition := NULL;
  END IF;
  IF definition IS NULL THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_invitation_id_fkey
      FOREIGN KEY (invitation_id) REFERENCES membership_invitations(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS outbox_events_pending_idx;
CREATE INDEX outbox_events_pending_idx
  ON outbox_events (available_at, created_at)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;

DROP INDEX IF EXISTS outbox_events_active_invitation_lease_idx;
CREATE INDEX outbox_events_active_invitation_lease_idx
  ON outbox_events (invitation_id, lease_until)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
