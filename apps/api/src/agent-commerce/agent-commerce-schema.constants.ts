export const AGENT_COMMERCE_SCHEMA = 'agent_commerce';

export const AGENT_COMMERCE_RELATIONS = [
  'oauth_clients',
  'agent_installations',
  'oauth_device_authorizations',
  'agent_grants',
  'oauth_refresh_token_families',
  'oauth_refresh_tokens',
  'oauth_access_token_jtis',
  'dpop_proof_replays',
  'dpop_nonces',
  'cryptographic_key_registry',
  'a2a_products',
  'a2a_tasks',
  'a2a_task_events',
  'a2a_idempotency',
  'checkout_quotes',
  'ap2_mandates',
  'ap2_constraints',
  'ap2_counters',
  'ap2_reservations',
  'payment_requirements',
  'payment_submissions',
  'settlements',
  'result_artifacts',
  'receipt_records',
  'reconciliation_cases',
  'refund_cases',
  'agent_push_subscriptions',
  'agent_push_deliveries',
  'transactional_outbox',
  'security_audit_events',
] as const;

export const AGENT_COMMERCE_REQUIRED_RELATIONS = AGENT_COMMERCE_RELATIONS.map(
  (relation) => `${AGENT_COMMERCE_SCHEMA}.${relation}`,
);

export const OAUTH_DEVICE_AUTHORIZATION_REQUIRED_COLUMNS = [
  'installation_name',
  'requested_authority',
] as const;

export const APPLE_ASSISTANT_OAUTH_CLIENT_ID = 'apple-assistant-native-v1';
