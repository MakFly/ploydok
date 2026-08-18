-- Durable BullMQ dispatch intents. This dedicated outbox stores reference-only
-- JSON payloads; secret-bearing mail remains in encrypted outbox_events.
CREATE TABLE IF NOT EXISTS queue_outbox_events (
  id text PRIMARY KEY,
  queue_name text NOT NULL,
  job_name text NOT NULL,
  job_id text NOT NULL,
  source_row_id text NOT NULL,
  actor_user_id text,
  source text NOT NULL DEFAULT 'system',
  payload jsonb NOT NULL,
  job_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT queue_outbox_events_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT queue_outbox_events_job_options_object_check
    CHECK (jsonb_typeof(job_options) = 'object'),
  CONSTRAINT queue_outbox_events_attempt_count_check
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_outbox_events_queue_job_unique
  ON queue_outbox_events (queue_name, job_id);

CREATE INDEX IF NOT EXISTS queue_outbox_events_pending_idx
  ON queue_outbox_events (available_at, created_at)
  WHERE dispatched_at IS NULL;
