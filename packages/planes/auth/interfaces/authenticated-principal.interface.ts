export interface AuthenticatedPrincipal {
  id: string;
  issuer: string;
  subject: string;
  email?: string;
  aud?: string;
  role?: string;
  appMetadata?: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
  phone?: string;
  identities?: unknown[];
  emailConfirmedAt?: Date;
  confirmedAt?: Date;
  lastSignInAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  rawClaims: Record<string, unknown>;
}
