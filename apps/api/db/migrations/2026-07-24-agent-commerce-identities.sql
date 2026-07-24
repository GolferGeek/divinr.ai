-- Apple Assistant <-> Divinr v0.2: connected-agent identity and credential state.
-- DDL belongs in versioned migrations. Runtime handlers must never recreate it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS agent_commerce;

CREATE TABLE agent_commerce.oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_type text NOT NULL CHECK (client_type IN ('public', 'confidential')),
  display_name text NOT NULL,
  software_id text NOT NULL,
  software_version text NOT NULL,
  allowed_grants text[] NOT NULL,
  token_endpoint_auth_methods text[] NOT NULL,
  allowed_scopes text[] NOT NULL,
  allowed_audiences text[] NOT NULL,
  client_secret_hash text,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (client_type <> 'public' OR client_secret_hash IS NULL)
);

CREATE TABLE agent_commerce.agent_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  oauth_client_id uuid NOT NULL REFERENCES agent_commerce.oauth_clients(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  dpop_jkt text NOT NULL,
  dpop_algorithm text NOT NULL CHECK (dpop_algorithm = 'ES256'),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'revoked', 'recovery_required')),
  approved_scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE UNIQUE INDEX agent_installations_active_user_jkt_uq
  ON agent_commerce.agent_installations (user_id, dpop_jkt)
  WHERE status = 'active';
CREATE INDEX agent_installations_client_status_idx
  ON agent_commerce.agent_installations (oauth_client_id, status);

CREATE TABLE agent_commerce.oauth_device_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id text NOT NULL UNIQUE,
  oauth_client_id uuid NOT NULL REFERENCES agent_commerce.oauth_clients(id) ON DELETE RESTRICT,
  installation_request_id text NOT NULL,
  user_id uuid,
  proposed_dpop_jkt text NOT NULL,
  device_code_hash text NOT NULL UNIQUE,
  user_code_keyed_hash text NOT NULL UNIQUE,
  requested_scopes text[] NOT NULL,
  requested_audiences text[] NOT NULL,
  verification_uri text NOT NULL,
  poll_interval_seconds integer NOT NULL CHECK (poll_interval_seconds >= 1),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  approved_at timestamptz,
  denied_at timestamptz,
  consumed_at timestamptz,
  approving_user_id uuid,
  denial_reason text,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  CHECK (consumed_at IS NULL OR status = 'consumed')
);
CREATE INDEX oauth_device_auth_client_installation_idx
  ON agent_commerce.oauth_device_authorizations (oauth_client_id, installation_request_id);
CREATE INDEX oauth_device_auth_status_expiry_idx
  ON agent_commerce.oauth_device_authorizations (status, expires_at);

CREATE TABLE agent_commerce.agent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  granted_scopes text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked', 'compromised')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  owner_authority_ref text NOT NULL,
  open_authority_ref text,
  approved_at timestamptz NOT NULL,
  approved_by uuid NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  CHECK (valid_until > valid_from)
);
CREATE UNIQUE INDEX agent_grants_active_user_installation_uq
  ON agent_commerce.agent_grants (user_id, installation_id)
  WHERE status = 'active';
CREATE INDEX agent_grants_installation_status_idx
  ON agent_commerce.agent_grants (installation_id, status);

CREATE TABLE agent_commerce.oauth_refresh_token_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES agent_commerce.agent_grants(id) ON DELETE RESTRICT,
  dpop_jkt text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'compromised', 'revoked')),
  current_generation integer NOT NULL DEFAULT 0 CHECK (current_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  compromised_at timestamptz,
  revoked_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE INDEX oauth_refresh_families_grant_status_idx
  ON agent_commerce.oauth_refresh_token_families (grant_id, status);

CREATE TABLE agent_commerce.oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  family_id uuid NOT NULL REFERENCES agent_commerce.oauth_refresh_token_families(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation >= 0),
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  replacement_token_id uuid REFERENCES agent_commerce.oauth_refresh_tokens(id) ON DELETE RESTRICT,
  UNIQUE (family_id, generation),
  CHECK (expires_at > issued_at)
);
CREATE INDEX oauth_refresh_tokens_unused_expiry_idx
  ON agent_commerce.oauth_refresh_tokens (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE agent_commerce.oauth_access_token_jtis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_jti text NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES agent_commerce.agent_grants(id) ON DELETE RESTRICT,
  audience text NOT NULL,
  scopes_hash text NOT NULL,
  dpop_jkt text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  CHECK (expires_at > issued_at)
);
CREATE INDEX oauth_access_token_grant_expiry_idx
  ON agent_commerce.oauth_access_token_jtis (grant_id, expires_at);

CREATE TABLE agent_commerce.dpop_proof_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dpop_jkt text NOT NULL,
  proof_jti text NOT NULL,
  http_method text NOT NULL,
  canonical_uri_hash text NOT NULL,
  access_token_hash text,
  seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (dpop_jkt, proof_jti)
);
CREATE INDEX dpop_proof_replays_expiry_idx
  ON agent_commerce.dpop_proof_replays (expires_at);

CREATE TABLE agent_commerce.dpop_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nonce_hash text NOT NULL UNIQUE,
  dpop_jkt text,
  installation_id uuid REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('authorization', 'token', 'resource')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  CHECK (dpop_jkt IS NOT NULL OR installation_id IS NOT NULL),
  CHECK (expires_at > issued_at)
);
CREATE INDEX dpop_nonces_active_key_expiry_idx
  ON agent_commerce.dpop_nonces (dpop_jkt, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX dpop_nonces_active_installation_expiry_idx
  ON agent_commerce.dpop_nonces (installation_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE agent_commerce.cryptographic_key_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id text NOT NULL,
  owner_service text NOT NULL,
  key_role text NOT NULL CHECK (
    key_role IN ('oauth_signing', 'ap2_merchant', 'quote', 'receipt', 'push', 'facade_mtls')
  ),
  algorithm text NOT NULL,
  public_jwk jsonb,
  certificate_sha256 text,
  external_custody_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'retiring', 'revoked', 'expired')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  supersedes_key_id uuid REFERENCES agent_commerce.cryptographic_key_registry(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (owner_service, key_role, key_id),
  CHECK (public_jwk IS NOT NULL OR certificate_sha256 IS NOT NULL),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (external_custody_ref !~* '(private|secret|seed|macaroon)')
);
CREATE INDEX cryptographic_key_registry_active_role_idx
  ON agent_commerce.cryptographic_key_registry (owner_service, key_role, valid_from, valid_until)
  WHERE status IN ('active', 'retiring');

CREATE FUNCTION agent_commerce.enforce_dpop_nonce_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = agent_commerce, pg_temp
AS $$
DECLARE active_count integer;
DECLARE lock_key text;
BEGIN
  IF NEW.consumed_at IS NOT NULL OR NEW.expires_at <= now() THEN
    RETURN NEW;
  END IF;
  lock_key := coalesce(NEW.installation_id::text, NEW.dpop_jkt);
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  SELECT count(*) INTO active_count
    FROM agent_commerce.dpop_nonces
   WHERE id <> NEW.id
     AND consumed_at IS NULL
     AND expires_at > now()
     AND (
       (NEW.installation_id IS NOT NULL AND installation_id = NEW.installation_id)
       OR (
         NEW.installation_id IS NULL
         AND installation_id IS NULL
         AND dpop_jkt = NEW.dpop_jkt
       )
     );
  IF active_count >= 4 THEN
    RAISE EXCEPTION 'maximum active DPoP nonces exceeded'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dpop_nonces_active_limit
  BEFORE INSERT OR UPDATE OF installation_id, dpop_jkt, expires_at, consumed_at
  ON agent_commerce.dpop_nonces
  FOR EACH ROW EXECUTE FUNCTION agent_commerce.enforce_dpop_nonce_limit();

-- User ownership is enforced for direct authenticated access. The API's
-- service role remains subject to explicit application authorization.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_installations',
    'oauth_device_authorizations',
    'agent_grants',
    'oauth_refresh_token_families',
    'oauth_refresh_tokens',
    'oauth_access_token_jtis',
    'dpop_proof_replays',
    'dpop_nonces'
  ]
  LOOP
    EXECUTE format('ALTER TABLE agent_commerce.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON agent_commerce.%I USING (user_id = nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid) WITH CHECK (user_id = nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid)',
      table_name || '_owner_policy',
      table_name
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA agent_commerce TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent_commerce TO service_role;
  END IF;
  -- No direct authenticated grants: OAuth and DPoP state is service-only.
END $$;

COMMIT;
