-- Phase 5 of stripe-integration: track which Stripe subscription_item the
-- BYO platform fee is attached to. CredentialsService writes this when
-- attaching the user's first BYO LLM credential and clears it when the last
-- one is detached.

-- The credentials schema is created lazily by CredentialsSchemaService
-- on first use; ensure it exists so this migration is order-independent.
CREATE SCHEMA IF NOT EXISTS credentials;
CREATE TABLE IF NOT EXISTS credentials.user_llm_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  provider text NOT NULL,
  encrypted_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credentials.user_llm_credentials
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text;
