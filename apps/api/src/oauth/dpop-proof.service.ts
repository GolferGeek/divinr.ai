import { Injectable } from '@nestjs/common';
import {
  createHash,
  createPublicKey,
  verify,
} from 'node:crypto';
import { canonicalJsonBytes } from '../agent-contracts/canonical-json';
import { OAuthProtocolError } from './oauth-errors';

interface DPoPHeader {
  alg?: unknown;
  typ?: unknown;
  jwk?: unknown;
}

interface DPoPPayload {
  htm?: unknown;
  htu?: unknown;
  iat?: unknown;
  jti?: unknown;
  nonce?: unknown;
}

interface PublicP256Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

function parsePart<T>(value: string, label: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw new OAuthProtocolError(401, 'invalid_dpop_proof', `Invalid DPoP ${label}`);
  }
}

function publicJwk(value: unknown): PublicP256Jwk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP public JWK is required');
  }
  const jwk = value as Record<string, unknown>;
  if (
    jwk.kty !== 'EC'
    || jwk.crv !== 'P-256'
    || typeof jwk.x !== 'string'
    || typeof jwk.y !== 'string'
    || 'd' in jwk
    || Object.keys(jwk).some((key) => !['kty', 'crv', 'x', 'y', 'use', 'key_ops', 'kid'].includes(key))
  ) {
    throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'Only a public P-256 JWK is allowed');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

@Injectable()
export class DPoPProofService {
  private readonly replay = new Map<string, number>();

  verify(
    compact: string | undefined,
    method: string,
    uri: string,
    expectedThumbprint?: string,
  ): { thumbprint: string; jti: string; nonce?: string } {
    if (!compact) {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP proof is required');
    }
    const parts = compact.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'Malformed DPoP proof');
    }
    const header = parsePart<DPoPHeader>(parts[0], 'header');
    const payload = parsePart<DPoPPayload>(parts[1], 'payload');
    const jwk = publicJwk(header.jwk);
    if (header.alg !== 'ES256' || String(header.typ).toLowerCase() !== 'dpop+jwt') {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP alg or typ is invalid');
    }
    if (
      payload.htm !== method.toUpperCase()
      || payload.htu !== uri
      || typeof payload.iat !== 'number'
      || !Number.isInteger(payload.iat)
      || Math.abs(Math.floor(Date.now() / 1000) - payload.iat) > 60
      || typeof payload.jti !== 'string'
      || payload.jti.length < 1
      || payload.jti.length > 128
    ) {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP claims are invalid');
    }
    let valid = false;
    try {
      valid = verify(
        'sha256',
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        {
          key: createPublicKey({ key: jwk as never, format: 'jwk' }),
          dsaEncoding: 'ieee-p1363',
        },
        Uint8Array.from(Buffer.from(parts[2], 'base64url')),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP signature is invalid');
    }
    const thumbprint = createHash('sha256')
      .update(canonicalJsonBytes(jwk))
      .digest('base64url');
    if (expectedThumbprint && thumbprint !== expectedThumbprint) {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP key does not match the authorization');
    }
    const replayKey = `${thumbprint}:${payload.jti}`;
    const now = Date.now();
    for (const [key, expiresAt] of this.replay) {
      if (expiresAt <= now) this.replay.delete(key);
    }
    if (this.replay.has(replayKey)) {
      throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP proof was already used');
    }
    this.replay.set(replayKey, now + 600_000);
    return {
      thumbprint,
      jti: payload.jti,
      ...(typeof payload.nonce === 'string' ? { nonce: payload.nonce } : {}),
    };
  }
}
