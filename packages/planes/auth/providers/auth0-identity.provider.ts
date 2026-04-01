import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { verifyOidcTokenFromEnv } from './oidc-jwt-verifier.util';

@Injectable()
export class Auth0IdentityProvider implements IdentityProvider {
  async validateToken(token: string): Promise<AuthenticatedPrincipal> {
    const claims = await verifyOidcTokenFromEnv(token, {
      providerLabel: 'Auth0',
      issuerUrl: 'AUTH0_ISSUER_URL',
      audience: 'AUTH0_AUDIENCE',
      jwksUri: 'AUTH0_JWKS_URI',
    });

    const subject = claims.sub;
    if (!subject) {
      throw new UnauthorizedException('Auth0 token missing subject claim');
    }
    if (typeof claims.iss !== 'string' || claims.iss.trim() === '') {
      throw new UnauthorizedException('Auth0 token missing issuer claim');
    }

    return {
      id: subject,
      issuer: claims.iss,
      subject,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      aud: Array.isArray(claims.aud) ? claims.aud.join(',') : claims.aud,
      role: typeof claims.role === 'string' ? claims.role : undefined,
      appMetadata: {},
      userMetadata: {},
      identities: [],
      rawClaims: claims as Record<string, unknown>,
    };
  }
}
