-- Apple Assistant <-> Divinr v0.2: products, tasks, quotes, and AP2 authority.

BEGIN;

CREATE TABLE agent_commerce.a2a_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  product_version integer NOT NULL CHECK (product_version > 0),
  skill_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  description text NOT NULL,
  input_schema_uri text NOT NULL,
  output_schema_uri text NOT NULL,
  input_schema_hash text NOT NULL,
  output_schema_hash text NOT NULL,
  pricing_policy jsonb NOT NULL,
  pricing_policy_hash text NOT NULL,
  ap2_required boolean NOT NULL,
  payment_class text NOT NULL CHECK (payment_class IN ('free', 'paid')),
  artifact_type text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (product_id, product_version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX a2a_products_active_skill_idx
  ON agent_commerce.a2a_products (skill_id, product_id)
  WHERE status = 'active';

CREATE TABLE agent_commerce.a2a_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_task_id text NOT NULL UNIQUE,
  context_id text NOT NULL,
  request_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL REFERENCES agent_commerce.agent_grants(id) ON DELETE RESTRICT,
  skill_id text NOT NULL,
  product_id text NOT NULL,
  product_version integer NOT NULL,
  scoped_idempotency_key text NOT NULL,
  business_input_hash text NOT NULL,
  base_intent_hash text NOT NULL,
  current_intent_hash text NOT NULL,
  intent_phase text NOT NULL CHECK (intent_phase IN ('request', 'quote', 'checkout', 'payment', 'result', 'refund')),
  a2a_state text NOT NULL CHECK (
    a2a_state IN ('submitted', 'working', 'input_required', 'auth_required', 'completed', 'canceled', 'failed', 'rejected')
  ),
  payment_state text NOT NULL CHECK (
    payment_state IN ('not_required', 'quote_required', 'payment_required', 'submitted', 'settled', 'failed', 'unknown', 'refunded')
  ),
  result_state text NOT NULL CHECK (
    result_state IN ('none', 'generating', 'generated', 'release_authorized', 'released', 'failed')
  ),
  quote_id uuid,
  payment_submission_id uuid,
  result_artifact_id uuid,
  expires_at timestamptz NOT NULL,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  terminal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  FOREIGN KEY (product_id, product_version)
    REFERENCES agent_commerce.a2a_products(product_id, product_version) ON DELETE RESTRICT
);
CREATE INDEX a2a_tasks_user_state_idx
  ON agent_commerce.a2a_tasks (user_id, a2a_state, created_at DESC);
CREATE INDEX a2a_tasks_installation_idempotency_idx
  ON agent_commerce.a2a_tasks (installation_id, scoped_idempotency_key);

CREATE TABLE agent_commerce.a2a_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  a2a_state text NOT NULL CHECK (
    a2a_state IN ('submitted', 'working', 'input_required', 'auth_required', 'completed', 'canceled', 'failed', 'rejected')
  ),
  canonical_event_hash text NOT NULL,
  safe_event_data jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, sequence)
);
CREATE INDEX a2a_task_events_timeline_idx
  ON agent_commerce.a2a_task_events (task_id, occurred_at);

CREATE TABLE agent_commerce.a2a_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope_hash text NOT NULL,
  idempotency_key text NOT NULL,
  immutable_base_intent_hash text NOT NULL,
  task_id uuid REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  current_intent_hash text NOT NULL,
  intent_phase text NOT NULL CHECK (intent_phase IN ('request', 'quote', 'checkout', 'payment', 'result', 'refund')),
  response_hash text,
  state_hash text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (scope_hash, idempotency_key)
);
CREATE INDEX a2a_idempotency_expiry_idx
  ON agent_commerce.a2a_idempotency (expires_at);

CREATE TABLE agent_commerce.checkout_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id text NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  product_version integer NOT NULL,
  merchant_id text NOT NULL,
  amount numeric(78,0) NOT NULL CHECK (amount > 0),
  asset text NOT NULL,
  unit text NOT NULL,
  network text NOT NULL,
  payment_method text NOT NULL,
  checkout_jwt_hash text NOT NULL UNIQUE,
  checkout_nonce_hash text NOT NULL UNIQUE,
  payment_nonce_hash text NOT NULL UNIQUE,
  signed_quote jsonb NOT NULL,
  signed_quote_ref text,
  canonical_quote_hash text NOT NULL UNIQUE,
  selected_requirement_hash text,
  status text NOT NULL CHECK (status IN ('active', 'accepted', 'expired', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  FOREIGN KEY (product_id, product_version)
    REFERENCES agent_commerce.a2a_products(product_id, product_version) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);
CREATE INDEX checkout_quotes_task_idx ON agent_commerce.checkout_quotes (task_id);
CREATE INDEX checkout_quotes_active_expiry_idx
  ON agent_commerce.checkout_quotes (expires_at) WHERE status = 'active';

CREATE TABLE agent_commerce.ap2_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id text NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  mandate_kind text NOT NULL CHECK (mandate_kind IN ('checkout_open', 'checkout_closed', 'payment_open', 'payment_closed')),
  vct text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  audience text NOT NULL,
  parent_mandate_id uuid REFERENCES agent_commerce.ap2_mandates(id) ON DELETE RESTRICT,
  open_mandate_id text,
  canonical_payload jsonb NOT NULL,
  canonical_payload_hash text NOT NULL UNIQUE,
  closed_leaf_jwt_hash text UNIQUE,
  signed_credential jsonb,
  signed_credential_ref text,
  disclosure_hashes text[] NOT NULL DEFAULT '{}',
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  signature_state text NOT NULL CHECK (signature_state IN ('pending', 'verified', 'invalid')),
  authority_state text NOT NULL CHECK (authority_state IN ('pending', 'verified', 'denied')),
  signature_verified_at timestamptz,
  authority_verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  CHECK (valid_until > valid_from),
  CHECK (mandate_kind NOT IN ('checkout_closed', 'payment_closed') OR closed_leaf_jwt_hash IS NOT NULL)
);
CREATE INDEX ap2_mandates_task_kind_idx
  ON agent_commerce.ap2_mandates (task_id, mandate_kind);

CREATE TABLE agent_commerce.ap2_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mandate_id uuid NOT NULL REFERENCES agent_commerce.ap2_mandates(id) ON DELETE RESTRICT,
  constraint_id text NOT NULL,
  namespace text NOT NULL,
  constraint_type text NOT NULL,
  constraint_version text NOT NULL,
  constraint_scope text NOT NULL,
  critical boolean NOT NULL,
  canonical_value jsonb NOT NULL,
  canonical_value_hash text NOT NULL,
  enforcement_state text NOT NULL CHECK (enforcement_state IN ('pending', 'satisfied', 'denied', 'unsupported')),
  verifier text,
  evaluated_at timestamptz,
  result_reason text,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (mandate_id, constraint_id)
);
CREATE INDEX ap2_constraints_counter_lookup_idx
  ON agent_commerce.ap2_constraints (constraint_type, constraint_scope);

CREATE TABLE agent_commerce.ap2_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  authority_id text NOT NULL,
  merchant_id text NOT NULL,
  product_id text NOT NULL,
  constraint_id text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  asset text NOT NULL,
  unit text NOT NULL,
  limit_amount numeric(78,0) NOT NULL CHECK (limit_amount >= 0),
  reserved_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
  committed_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  limit_count integer NOT NULL CHECK (limit_count >= 0),
  reserved_count integer NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  committed_count integer NOT NULL DEFAULT 0 CHECK (committed_count >= 0),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authority_id, merchant_id, product_id, constraint_id, window_start, window_end),
  CHECK (window_end > window_start),
  CHECK (reserved_amount + committed_amount <= limit_amount),
  CHECK (reserved_count + committed_count <= limit_count)
);
CREATE INDEX ap2_counters_active_window_idx
  ON agent_commerce.ap2_counters (user_id, authority_id, window_start, window_end);

CREATE TABLE agent_commerce.ap2_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  counter_id uuid NOT NULL REFERENCES agent_commerce.ap2_counters(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES agent_commerce.checkout_quotes(id) ON DELETE RESTRICT,
  mandate_id uuid NOT NULL REFERENCES agent_commerce.ap2_mandates(id) ON DELETE RESTRICT,
  amount numeric(78,0) NOT NULL CHECK (amount >= 0),
  reservation_count integer NOT NULL CHECK (reservation_count >= 0),
  state text NOT NULL CHECK (state IN ('reserved', 'committed', 'released', 'expired')),
  expires_at timestamptz NOT NULL,
  committed_at timestamptz,
  released_at timestamptz,
  settlement_id uuid,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (counter_id, task_id),
  CHECK (state <> 'committed' OR committed_at IS NOT NULL),
  CHECK (state <> 'released' OR (released_at IS NOT NULL AND settlement_id IS NULL))
);
CREATE INDEX ap2_reservations_active_expiry_idx
  ON agent_commerce.ap2_reservations (expires_at) WHERE state = 'reserved';

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'a2a_tasks',
    'a2a_task_events',
    'a2a_idempotency',
    'checkout_quotes',
    'ap2_mandates',
    'ap2_constraints',
    'ap2_counters',
    'ap2_reservations'
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent_commerce TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA agent_commerce TO authenticated;
    GRANT SELECT ON agent_commerce.a2a_products TO authenticated;
  END IF;
END $$;

COMMIT;
