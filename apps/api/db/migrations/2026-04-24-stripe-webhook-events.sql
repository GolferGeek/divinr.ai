-- Idempotency + audit trail for every inbound Stripe webhook event.
--
-- The webhook handler INSERTs each event id with ON CONFLICT (event_id) DO NOTHING,
-- so duplicate deliveries (Stripe retries on 5xx) collapse to a single row. Successful
-- handler runs stamp processed_at; failures stamp handler_error and return 500 so
-- Stripe will retry.

CREATE TABLE IF NOT EXISTS billing.stripe_webhook_events (
  event_id          text PRIMARY KEY,
  event_type        text NOT NULL,
  stripe_created_at timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  user_id           text,
  payload           jsonb NOT NULL,
  handler_error     text
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_user_idx
  ON billing.stripe_webhook_events(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_idx
  ON billing.stripe_webhook_events(event_type, received_at DESC);
