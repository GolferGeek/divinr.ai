import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { verifyOidcTokenFromEnv } from './oidc-jwt-verifier.util';

@Injectable()
export class GoogleOidcIdentityProvider implements IdentityProvider {
  async validateToken(token: string): Promise<AuthenticatedPrincipal> {
    const claims = await verifyOidcTokenFromEnv(token, {
      providerLabel: 'Google OIDC',
      issuerUrl: 'GOOGLE_ISSUER_URL',
      audience: 'GOOGLE_CLIENT_ID',
      jwksUri: 'GOOGLE_JWKS_URI',
    });

    const subject = claims.sub;
    if (!subject) {
      throw new UnauthorizedException(
        'Google OIDC token missing subject claim',
      );
    }
    if (typeof claims.iss !== 'string' || claims.iss.trim() === '') {
      throw new UnauthorizedException('Google OIDC token missing issuer claim');
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
