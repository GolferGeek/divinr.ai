-- Retain the complete safe review snapshot presented during device approval.
-- This is additive because the base identity migration predates the Phase 4 UI.

BEGIN;

ALTER TABLE agent_commerce.oauth_device_authorizations
  ADD COLUMN installation_name text NOT NULL,
  ADD COLUMN requested_authority jsonb NOT NULL;

ALTER TABLE agent_commerce.oauth_device_authorizations
  ADD CONSTRAINT oauth_device_authorizations_installation_name_length
    CHECK (length(installation_name) BETWEEN 1 AND 120),
  ADD CONSTRAINT oauth_device_authorizations_requested_authority_object
    CHECK (jsonb_typeof(requested_authority) = 'object');

COMMIT;
