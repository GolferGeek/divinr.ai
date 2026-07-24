export interface ApprovalBody {
  confirmation?: unknown;
  schemaVersion?: unknown;
  installationId?: unknown;
  dpopJkt?: unknown;
  scopes?: unknown;
  authorityProfileVersion?: unknown;
}

export interface DenialBody {
  confirmation?: unknown;
  schemaVersion?: unknown;
  installationId?: unknown;
}

export interface RevocationBody {
  confirmation?: unknown;
  reason?: unknown;
}
