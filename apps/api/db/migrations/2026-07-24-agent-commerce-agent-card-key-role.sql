-- The frozen JWKS contract requires a dedicated agent-card signing key.
-- Keep its custody and rotation independent from OAuth, quotes, and receipts.

BEGIN;

ALTER TABLE agent_commerce.cryptographic_key_registry
  DROP CONSTRAINT cryptographic_key_registry_key_role_check;

ALTER TABLE agent_commerce.cryptographic_key_registry
  ADD CONSTRAINT cryptographic_key_registry_key_role_check CHECK (
    key_role IN (
      'agent_card',
      'oauth_signing',
      'ap2_merchant',
      'quote',
      'receipt',
      'push',
      'facade_mtls'
    )
  );

COMMIT;
