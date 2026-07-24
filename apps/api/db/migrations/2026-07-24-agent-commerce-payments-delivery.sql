-- Apple Assistant <-> Divinr v0.2: payment evidence, result release,
-- reconciliation/refunds, push delivery, outbox, and append-only audit.

BEGIN;

CREATE TABLE agent_commerce.payment_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES agent_commerce.checkout_quotes(id) ON DELETE RESTRICT,
  compatibility_profile text NOT NULL,
  extension_uri text NOT NULL,
  canonical_requirement jsonb NOT NULL,
  canonical_requirement_hash text NOT NULL UNIQUE,
  amount numeric(78,0) NOT NULL CHECK (amount > 0),
  asset text NOT NULL,
  unit text NOT NULL,
  network text NOT NULL,
  payment_method text NOT NULL,
  invoice_reference_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'accepted', 'expired', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  CHECK (expires_at > created_at)
);
CREATE INDEX payment_requirements_task_idx ON agent_commerce.payment_requirements (task_id);
CREATE INDEX payment_requirements_expiry_idx
  ON agent_commerce.payment_requirements (expires_at) WHERE status = 'active';

CREATE TABLE agent_commerce.payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  requirement_id uuid NOT NULL REFERENCES agent_commerce.payment_requirements(id) ON DELETE RESTRICT,
  payment_mandate_id uuid NOT NULL REFERENCES agent_commerce.ap2_mandates(id) ON DELETE RESTRICT,
  checkout_mandate_leaf_hash text NOT NULL,
  checkout_receipt_id text NOT NULL,
  checkout_receipt_hash text NOT NULL,
  payment_mandate_leaf_hash text NOT NULL,
  scoped_idempotency_key text NOT NULL,
  canonical_evidence jsonb NOT NULL,
  canonical_evidence_hash text NOT NULL UNIQUE,
  safe_evidence_ref text,
  payer_authority_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('submitted', 'verifying', 'accepted', 'rejected', 'unknown')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  failure_code text,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE UNIQUE INDEX payment_submissions_accepted_task_requirement_uq
  ON agent_commerce.payment_submissions (task_id, requirement_id)
  WHERE state = 'accepted';
CREATE INDEX payment_submissions_state_idx
  ON agent_commerce.payment_submissions (state, submitted_at);

CREATE TABLE agent_commerce.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  submission_id uuid NOT NULL REFERENCES agent_commerce.payment_submissions(id) ON DELETE RESTRICT,
  merchant_observation_id text NOT NULL,
  invoice_hash text NOT NULL,
  payment_hash text NOT NULL UNIQUE,
  amount numeric(78,0) NOT NULL CHECK (amount > 0),
  asset text NOT NULL,
  unit text NOT NULL,
  fee_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  state text NOT NULL CHECK (state IN ('pending', 'verified', 'failed', 'unknown', 'reconciled', 'refunded')),
  verification_evidence jsonb NOT NULL,
  verification_evidence_ref text,
  observed_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  reconciled_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE INDEX settlements_submission_idx ON agent_commerce.settlements (submission_id);

CREATE TABLE agent_commerce.result_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  product_version integer NOT NULL,
  content_hash text NOT NULL,
  storage_ref text NOT NULL,
  media_type text NOT NULL,
  schema_uri text NOT NULL,
  schema_hash text NOT NULL,
  generation_state text NOT NULL CHECK (generation_state IN ('pending', 'generating', 'generated', 'failed')),
  release_state text NOT NULL CHECK (release_state IN ('held', 'authorized', 'released', 'revoked')),
  release_settlement_id uuid REFERENCES agent_commerce.settlements(id) ON DELETE RESTRICT,
  release_receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz,
  released_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  FOREIGN KEY (product_id, product_version)
    REFERENCES agent_commerce.a2a_products(product_id, product_version) ON DELETE RESTRICT,
  UNIQUE (task_id, content_hash),
  CHECK (
    release_state <> 'released'
    OR (release_settlement_id IS NOT NULL AND release_receipt_id IS NOT NULL AND released_at IS NOT NULL)
  )
);
CREATE INDEX result_artifacts_task_release_idx
  ON agent_commerce.result_artifacts (task_id, release_state);

CREATE TABLE agent_commerce.receipt_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id text NOT NULL UNIQUE,
  receipt_type text NOT NULL CHECK (receipt_type IN ('checkout', 'payment', 'service', 'refund')),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  quote_id uuid REFERENCES agent_commerce.checkout_quotes(id) ON DELETE RESTRICT,
  mandate_id uuid REFERENCES agent_commerce.ap2_mandates(id) ON DELETE RESTRICT,
  submission_id uuid REFERENCES agent_commerce.payment_submissions(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES agent_commerce.settlements(id) ON DELETE RESTRICT,
  artifact_id uuid REFERENCES agent_commerce.result_artifacts(id) ON DELETE RESTRICT,
  issuer text NOT NULL,
  signer text NOT NULL,
  key_id uuid NOT NULL REFERENCES agent_commerce.cryptographic_key_registry(id) ON DELETE RESTRICT,
  canonical_payload jsonb NOT NULL,
  canonical_payload_hash text NOT NULL UNIQUE,
  signed_receipt jsonb,
  signed_receipt_ref text,
  verification_state text NOT NULL CHECK (verification_state IN ('pending', 'verified', 'invalid', 'superseded')),
  verified_at timestamptz,
  supersedes_receipt_id uuid REFERENCES agent_commerce.receipt_records(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE INDEX receipt_records_task_type_idx
  ON agent_commerce.receipt_records (task_id, receipt_type);

ALTER TABLE agent_commerce.result_artifacts
  ADD CONSTRAINT result_artifacts_release_receipt_fk
  FOREIGN KEY (release_receipt_id)
  REFERENCES agent_commerce.receipt_records(id) ON DELETE RESTRICT;

CREATE TABLE agent_commerce.reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  payment_submission_id uuid REFERENCES agent_commerce.payment_submissions(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES agent_commerce.settlements(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'leased', 'resolved', 'failed')),
  expected_state text NOT NULL,
  observed_state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE UNIQUE INDEX reconciliation_cases_active_subject_reason_uq
  ON agent_commerce.reconciliation_cases (
    task_id,
    coalesce(payment_submission_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(settlement_id, '00000000-0000-0000-0000-000000000000'::uuid),
    reason
  )
  WHERE state IN ('open', 'leased');
CREATE INDEX reconciliation_cases_work_queue_idx
  ON agent_commerce.reconciliation_cases (state, next_attempt_at);

CREATE TABLE agent_commerce.refund_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  original_submission_id uuid NOT NULL REFERENCES agent_commerce.payment_submissions(id) ON DELETE RESTRICT,
  original_settlement_id uuid NOT NULL REFERENCES agent_commerce.settlements(id) ON DELETE RESTRICT,
  original_payment_hash text NOT NULL,
  reason text NOT NULL,
  payer_refund_invoice_id text,
  protected_refund_invoice_ref text,
  refund_payment_hash text UNIQUE,
  amount numeric(78,0) NOT NULL CHECK (amount > 0),
  asset text NOT NULL,
  unit text NOT NULL,
  payer_observation_state text NOT NULL,
  merchant_observation_state text NOT NULL,
  state text NOT NULL CHECK (state IN ('requested', 'invoice_created', 'paying', 'settled', 'failed', 'unknown', 'reconciled')),
  receipt_id uuid REFERENCES agent_commerce.receipt_records(id) ON DELETE RESTRICT,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  completed_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE UNIQUE INDEX refund_cases_active_settlement_reason_uq
  ON agent_commerce.refund_cases (original_settlement_id, reason)
  WHERE state IN ('requested', 'invoice_created', 'paying', 'unknown');
CREATE INDEX refund_cases_work_queue_idx
  ON agent_commerce.refund_cases (state, next_attempt_at);

CREATE TABLE agent_commerce.agent_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  callback_origin text NOT NULL,
  callback_path text NOT NULL,
  authentication_profile text NOT NULL,
  authentication_public_key jsonb NOT NULL,
  allowed_event_types text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
CREATE UNIQUE INDEX push_subscriptions_active_callback_uq
  ON agent_commerce.agent_push_subscriptions (installation_id, callback_origin, callback_path)
  WHERE status = 'active';

CREATE TABLE agent_commerce.agent_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE,
  event_id text NOT NULL,
  user_id uuid NOT NULL,
  subscription_id uuid NOT NULL REFERENCES agent_commerce.agent_push_subscriptions(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  receipt_id uuid REFERENCES agent_commerce.receipt_records(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  canonical_payload_hash text NOT NULL,
  payload_ref text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  state text NOT NULL CHECK (state IN ('pending', 'leased', 'delivered', 'failed', 'expired')),
  not_before timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  response_hash text,
  acknowledgment_hash text,
  delivered_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (subscription_id, event_id)
);
CREATE UNIQUE INDEX push_deliveries_success_uq
  ON agent_commerce.agent_push_deliveries (subscription_id, event_id)
  WHERE state = 'delivered';
CREATE INDEX push_deliveries_ready_queue_idx
  ON agent_commerce.agent_push_deliveries (state, not_before, lease_expires_at);

CREATE TABLE agent_commerce.transactional_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id text NOT NULL UNIQUE,
  user_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 0),
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  payload_ref text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'leased', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  not_before timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  UNIQUE (aggregate_type, aggregate_id, aggregate_version, event_type)
);
CREATE INDEX transactional_outbox_ready_queue_idx
  ON agent_commerce.transactional_outbox (state, not_before, lease_expires_at);

CREATE TABLE agent_commerce.security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  ordering_key text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  actor_principal text NOT NULL,
  user_id uuid,
  installation_id uuid REFERENCES agent_commerce.agent_installations(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES agent_commerce.a2a_tasks(id) ON DELETE RESTRICT,
  mandate_id uuid REFERENCES agent_commerce.ap2_mandates(id) ON DELETE RESTRICT,
  payment_submission_id uuid REFERENCES agent_commerce.payment_submissions(id) ON DELETE RESTRICT,
  receipt_id uuid REFERENCES agent_commerce.receipt_records(id) ON DELETE RESTRICT,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'succeeded', 'failed', 'unknown')),
  reason text,
  redacted_detail jsonb NOT NULL,
  previous_event_hash text,
  event_hash text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ordering_key, sequence)
);
CREATE INDEX security_audit_events_user_time_idx
  ON agent_commerce.security_audit_events (user_id, occurred_at DESC);
CREATE INDEX security_audit_events_task_time_idx
  ON agent_commerce.security_audit_events (task_id, occurred_at);

-- Close references intentionally deferred until all relation targets exist.
ALTER TABLE agent_commerce.a2a_tasks
  ADD CONSTRAINT a2a_tasks_quote_fk
    FOREIGN KEY (quote_id) REFERENCES agent_commerce.checkout_quotes(id) ON DELETE RESTRICT,
  ADD CONSTRAINT a2a_tasks_payment_submission_fk
    FOREIGN KEY (payment_submission_id) REFERENCES agent_commerce.payment_submissions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT a2a_tasks_result_artifact_fk
    FOREIGN KEY (result_artifact_id) REFERENCES agent_commerce.result_artifacts(id) ON DELETE RESTRICT;

ALTER TABLE agent_commerce.ap2_reservations
  ADD CONSTRAINT ap2_reservations_settlement_fk
  FOREIGN KEY (settlement_id) REFERENCES agent_commerce.settlements(id) ON DELETE RESTRICT;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'payment_requirements',
    'payment_submissions',
    'settlements',
    'result_artifacts',
    'receipt_records',
    'reconciliation_cases',
    'refund_cases',
    'agent_push_subscriptions',
    'agent_push_deliveries'
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

ALTER TABLE agent_commerce.transactional_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY transactional_outbox_owner_policy
  ON agent_commerce.transactional_outbox
  USING (
    user_id IS NOT NULL
    AND user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  )
  WITH CHECK (
    user_id IS NOT NULL
    AND user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );

ALTER TABLE agent_commerce.security_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_audit_events_owner_read_policy
  ON agent_commerce.security_audit_events FOR SELECT
  USING (
    user_id IS NOT NULL
    AND user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent_commerce TO service_role;
    REVOKE UPDATE, DELETE ON agent_commerce.security_audit_events FROM service_role;
  END IF;
  -- Results, receipts, payments, delivery state, and audit remain service-only.
END $$;

COMMIT;
