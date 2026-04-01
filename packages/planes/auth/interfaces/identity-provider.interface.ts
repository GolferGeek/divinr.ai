import { AuthenticatedPrincipal } from './authenticated-principal.interface';

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export interface IdentityProvider {
  validateToken(token: string): Promise<AuthenticatedPrincipal>;
}
