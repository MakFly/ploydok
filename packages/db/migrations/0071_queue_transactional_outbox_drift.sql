-- Repair hosts where an early 0068 draft was applied before audit metadata was
-- added. Fresh hosts already have these columns; every statement is idempotent.
ALTER TABLE queue_outbox_events
  ADD COLUMN IF NOT EXISTS source_row_id text,
  ADD COLUMN IF NOT EXISTS actor_user_id text,
  ADD COLUMN IF NOT EXISTS source text;

UPDATE queue_outbox_events
SET source_row_id = job_id
WHERE source_row_id IS NULL;

UPDATE queue_outbox_events
SET source = 'system'
WHERE source IS NULL;

ALTER TABLE queue_outbox_events
  ALTER COLUMN source_row_id SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'system',
  ALTER COLUMN source SET NOT NULL;
