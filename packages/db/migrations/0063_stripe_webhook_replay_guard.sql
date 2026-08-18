CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "lease_token" text,
  "lease_until" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

