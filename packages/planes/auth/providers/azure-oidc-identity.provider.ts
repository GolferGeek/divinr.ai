import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { verifyOidcTokenFromEnv } from './oidc-jwt-verifier.util';

@Injectable()
export class AzureOidcIdentityProvider implements IdentityProvider {
  async validateToken(token: string): Promise<AuthenticatedPrincipal> {
    const claims = await verifyOidcTokenFromEnv(token, {
      providerLabel: 'Azure OIDC',
      issuerUrl: 'AZURE_ISSUER_URL',
      audience: 'AZURE_AD_CLIENT_ID',
      jwksUri: 'AZURE_JWKS_URI',
    });

    const subject = claims.sub;
    if (!subject) {
      throw new UnauthorizedException('Azure OIDC token missing subject claim');
    }
    if (typeof claims.iss !== 'string' || claims.iss.trim() === '') {
      throw new UnauthorizedException('Azure OIDC token missing issuer claim');
    }

    return {
      id: subject,
      issuer: claims.iss,
      subject,
      email:
        typeof claims.email === 'string'
          ? claims.email
          : typeof claims.preferred_username === 'string'
            ? claims.preferred_username
            : undefined,
      aud: Array.isArray(claims.aud) ? claims.aud.join(',') : claims.aud,
      role: typeof claims.role === 'string' ? claims.role : undefined,
      appMetadata: {},
      userMetadata: {},
      identities: [],
      rawClaims: claims as Record<string, unknown>,
    };
  }
}
