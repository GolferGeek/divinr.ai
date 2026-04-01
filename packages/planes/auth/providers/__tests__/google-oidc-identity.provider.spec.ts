import { UnauthorizedException } from '@nestjs/common';
import { GoogleOidcIdentityProvider } from '../google-oidc-identity.provider';

jest.mock('../oidc-jwt-verifier.util', () => ({
  verifyOidcTokenFromEnv: jest.fn(),
}));

import { verifyOidcTokenFromEnv } from '../oidc-jwt-verifier.util';

describe('GoogleOidcIdentityProvider', () => {
  let provider: GoogleOidcIdentityProvider;
  const mockVerify = verifyOidcTokenFromEnv as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GoogleOidcIdentityProvider();
  });

  it('returns AuthenticatedPrincipal for a valid token', async () => {
    mockVerify.mockResolvedValueOnce({
      sub: 'google-user-123',
      iss: 'https://accounts.google.com',
      aud: 'my-client-id',
      email: 'user@example.com',
    });

    const result = await provider.validateToken('valid-token');

    expect(result.id).toBe('google-user-123');
    expect(result.subject).toBe('google-user-123');
    expect(result.issuer).toBe('https://accounts.google.com');
    expect(result.email).toBe('user@example.com');
    expect(result.aud).toBe('my-client-id');
  });

  it('joins audience array into comma-separated string', async () => {
    mockVerify.mockResolvedValueOnce({
      sub: 'google-user-456',
      iss: 'https://accounts.google.com',
      aud: ['client-id-1', 'client-id-2'],
      email: 'user@example.com',
    });

    const result = await provider.validateToken('valid-token-multi-aud');

    expect(result.aud).toBe('client-id-1,client-id-2');
  });

  it('throws UnauthorizedException when subject claim is missing', async () => {
    mockVerify.mockResolvedValue({
      sub: undefined,
      iss: 'https://accounts.google.com',
      aud: 'my-client-id',
    });

    await expect(provider.validateToken('no-sub-token')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(provider.validateToken('no-sub-token')).rejects.toThrow(
      'Google OIDC token missing subject claim',
    );
  });

  it('throws UnauthorizedException when issuer claim is missing', async () => {
    mockVerify.mockResolvedValue({
      sub: 'google-user-789',
      iss: '',
      aud: 'my-client-id',
    });

    await expect(provider.validateToken('no-iss-token')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(provider.validateToken('no-iss-token')).rejects.toThrow(
      'Google OIDC token missing issuer claim',
    );
  });

  it('uses preferred_username as email fallback when email claim is absent', async () => {
    mockVerify.mockResolvedValueOnce({
      sub: 'google-user-001',
      iss: 'https://accounts.google.com',
      aud: 'my-client-id',
      preferred_username: 'username@example.com',
    });

    const result = await provider.validateToken(
      'token-with-preferred-username',
    );

    expect(result.email).toBe('username@example.com');
  });

  it('passes the correct config labels to verifyOidcTokenFromEnv', async () => {
    mockVerify.mockResolvedValueOnce({
      sub: 'google-user-002',
      iss: 'https://accounts.google.com',
      aud: 'my-client-id',
    });

    await provider.validateToken('any-token');

    expect(mockVerify).toHaveBeenCalledWith('any-token', {
      providerLabel: 'Google OIDC',
      issuerUrl: 'GOOGLE_ISSUER_URL',
      audience: 'GOOGLE_CLIENT_ID',
      jwksUri: 'GOOGLE_JWKS_URI',
    });
  });
});
