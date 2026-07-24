export interface DeviceAuthorizationRequest {
  client_id: string;
  scope: string;
  resource: string;
  installation_id: string;
  installation_name: string;
}

export interface TokenRequest {
  grant_type: string;
  client_id: string;
  device_code?: string;
  refresh_token?: string;
}

export interface DeviceAuthorizationRow {
  id: string;
  authorization_id: string;
  oauth_client_id: string;
  installation_request_id: string;
  installation_name: string;
  user_id: string | null;
  proposed_dpop_jkt: string;
  requested_scopes: string[];
  requested_audiences: string[];
  requested_authority: Record<string, unknown>;
  verification_uri: string;
  poll_interval_seconds: number;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
  expires_at: string;
  created_at: string;
  last_polled_at: string | null;
  approving_user_id: string | null;
  denied_at: string | null;
}
