export interface TaskAdmissionInput {
  internalTaskId: string;
  protocolTaskId: string;
  contextId: string;
  requestId: string;
  userId: string;
  installationId: string;
  grantId: string;
  skillId: string;
  productId: string;
  productVersion: number;
  idempotencyScopeHash: string;
  idempotencyKey: string;
  businessInputHash: string;
  baseIntentHash: string;
  currentIntentHash: string;
  expiresAt: string;
}

export interface TaskAdmissionResult {
  created: boolean;
  taskId: string;
}

export interface QuoteCreationInput {
  internalQuoteId: string;
  quoteId: string;
  taskId: string;
  userId: string;
  installationId: string;
  productId: string;
  productVersion: number;
  merchantId: string;
  amount: string;
  asset: string;
  unit: string;
  network: string;
  paymentMethod: string;
  checkoutJwtHash: string;
  checkoutNonceHash: string;
  paymentNonceHash: string;
  signedQuote: unknown;
  signedQuoteRef?: string;
  canonicalQuoteHash: string;
  requirementId: string;
  canonicalRequirement: unknown;
  canonicalRequirementHash: string;
  compatibilityProfile: string;
  extensionUri: string;
  invoiceReferenceHash: string;
  expiresAt: string;
}

export interface CounterReservationInput {
  reservationId: string;
  userId: string;
  counterId: string;
  taskId: string;
  quoteId: string;
  mandateId: string;
  amount: string;
  count: number;
  expiresAt: string;
}

export interface SettlementCommitInput {
  internalSettlementId: string;
  settlementId: string;
  userId: string;
  submissionId: string;
  taskId: string;
  merchantObservationId: string;
  invoiceHash: string;
  paymentHash: string;
  amount: string;
  asset: string;
  unit: string;
  feeAmount: string;
  verificationEvidence: unknown;
  verificationEvidenceRef?: string;
  observedAt: string;
  confirmedAt: string;
}

export interface ArtifactReleaseInput {
  taskId: string;
  artifactId: string;
  settlementId: string;
  receiptId: string;
  releasedAt: string;
}

export interface RefundCreationInput {
  refundId: string;
  userId: string;
  taskId: string;
  originalSubmissionId: string;
  originalSettlementId: string;
  originalPaymentHash: string;
  reason: string;
  amount: string;
  asset: string;
  unit: string;
  expiresAt: string;
}

export interface OutboxInput {
  outboxId: string;
  userId?: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  payloadHash: string;
  payloadRef: string;
}

export interface AuditEventInput {
  eventId: string;
  orderingKey: string;
  actorPrincipal: string;
  userId?: string;
  installationId?: string;
  taskId?: string;
  mandateId?: string;
  paymentSubmissionId?: string;
  receiptId?: string;
  action: string;
  outcome: 'allowed' | 'denied' | 'succeeded' | 'failed' | 'unknown';
  reason?: string;
  redactedDetail: unknown;
}
