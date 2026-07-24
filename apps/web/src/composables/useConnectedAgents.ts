import { useApi } from './useApi';

export interface AuthorityReview {
  profileVersion: number;
  mode: string;
  network: string;
  economicValue: boolean;
  productPriceMinorUnits: { minimum: number; maximum: number };
  maximumSuccessfulCalls: number;
  maximumCumulativePriceMinorUnits: number;
  maximumAtomicAmount: string;
  maximumPerTransactionAtomicAmount: string;
  authorityWindowSeconds: number;
}

export interface DeviceReview {
  schemaVersion: 2;
  installationId: string;
  installationName: string;
  dpopJkt: string;
  scopes: string[];
  resources: string[];
  authority: AuthorityReview;
  expiresAt: string;
  status: string;
}

export interface AgentGrant {
  grantId: string;
  status: string;
  scopes: string[];
  validFrom: string;
  validUntil: string;
  approvedAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  ownerAuthorityRef?: string;
  openAuthorityRef?: string | null;
}

export interface ConnectedAgent {
  installationId: string;
  displayName: string;
  dpopJkt: string;
  status: string;
  approvedScopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  grants: AgentGrant[];
}

export interface ConnectedAgentDetail extends ConnectedAgent {
  revokedReason?: string | null;
  audit: Array<{
    eventId: string;
    action: string;
    outcome: string;
    reason?: string | null;
    detail: Record<string, unknown>;
    occurredAt: string;
  }>;
  receipts: Array<{
    receiptId: string;
    receiptType: string;
    verificationState: string;
    signedReceiptRef?: string | null;
    createdAt: string;
  }>;
}

export function useConnectedAgents() {
  const api = useApi('/api/connected-agents');
  return {
    loading: api.loading,
    error: api.error,
    reviewDevice: (userCode: string) =>
      api.get<DeviceReview>(`/device/${encodeURIComponent(userCode)}`),
    approveDevice: (userCode: string, review: DeviceReview) =>
      api.post(`/device/${encodeURIComponent(userCode)}/approve`, {
        confirmation: 'APPROVE',
        schemaVersion: review.schemaVersion,
        installationId: review.installationId,
        dpopJkt: review.dpopJkt,
        scopes: review.scopes,
        authorityProfileVersion: review.authority.profileVersion,
      }),
    denyDevice: (userCode: string, review: DeviceReview) =>
      api.post(`/device/${encodeURIComponent(userCode)}/deny`, {
        confirmation: 'DENY',
        schemaVersion: review.schemaVersion,
        installationId: review.installationId,
      }),
    list: () => api.get<ConnectedAgent[]>(''),
    detail: (installationId: string) =>
      api.get<ConnectedAgentDetail>(`/${encodeURIComponent(installationId)}`),
    revokeGrant: (
      installationId: string,
      grantId: string,
      reason: string,
    ) => api.post(
      `/${encodeURIComponent(installationId)}/grants/${encodeURIComponent(grantId)}/revoke`,
      { confirmation: 'REVOKE GRANT', reason },
    ),
    revokeInstallation: (installationId: string, reason: string) =>
      api.post(`/${encodeURIComponent(installationId)}/revoke`, {
        confirmation: 'REVOKE AGENT',
        reason,
      }),
  };
}
