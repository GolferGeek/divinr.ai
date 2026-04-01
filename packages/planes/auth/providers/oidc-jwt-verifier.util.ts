import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

interface OidcVerificationConfig {
  providerLabel: string;
  issuerUrl: string;
  audience: string;
  jwksUri: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new UnauthorizedException(
      `Missing required environment variable: ${name}`,
    );
  }
  return value;
}

function getOrCreateRemoteJwks(jwksUri: string) {
  const cached = jwksCache.get(jwksUri);
  if (cached) {
    return cached;
  }

  const remoteJwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, remoteJwks);
  return remoteJwks;
}

export async function verifyOidcTokenFromEnv(
  token: string,
  config: OidcVerificationConfig,
): Promise<JWTPayload> {
  const issuer = getRequiredEnv(config.issuerUrl);
  const audience = getRequiredEnv(config.audience);
  const jwksUri = getRequiredEnv(config.jwksUri);

  try {
    const jwks = getOrCreateRemoteJwks(jwksUri);

    // Azure client credentials tokens use v1 issuer (sts.windows.net)
    // even when requested via v2.0 endpoint. Accept both formats.
    const issuers = [issuer];
    const tenantMatch = issuer.match(/login\.microsoftonline\.com\/([^/]+)/);
    if (tenantMatch) {
      issuers.push(`https://sts.windows.net/${tenantMatch[1]}/`);
    }

    const { payload } = await jwtVerify(token, jwks, {
      issuer: issuers,
      audience,
    });
    return payload;
  } catch {
    throw new UnauthorizedException(
      `${config.providerLabel} token validation failed`,
    );
  }
}
