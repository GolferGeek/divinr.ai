import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase-client.service';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';

@Injectable()
export class SupabaseIdentityProvider implements IdentityProvider {
  constructor(@Inject(SupabaseService) private readonly supabaseService: SupabaseService) {}

  async validateToken(token: string): Promise<AuthenticatedPrincipal> {
    const supabaseClient = this.supabaseService.getAnonClient();
    const {
      data: { user },
      error,
    } = await supabaseClient.auth.getUser(token);

    if (error || !user) {
      throw new UnauthorizedException('Invalid token');
    }

    const issuer =
      typeof user.app_metadata?.['iss'] === 'string'
        ? user.app_metadata['iss']
        : 'supabase';

    return {
      id: user.id,
      issuer,
      subject: user.id,
      email: user.email ?? undefined,
      aud: user.aud,
      role: user.role ?? 'authenticated',
      appMetadata: (user.app_metadata as Record<string, unknown>) || {},
      userMetadata: (user.user_metadata as Record<string, unknown>) || {},
      phone: user.phone ?? undefined,
      emailConfirmedAt: user.email_confirmed_at
        ? new Date(user.email_confirmed_at)
        : undefined,
      confirmedAt: user.confirmed_at ? new Date(user.confirmed_at) : undefined,
      lastSignInAt: user.last_sign_in_at
        ? new Date(user.last_sign_in_at)
        : undefined,
      createdAt: user.created_at ? new Date(user.created_at) : undefined,
      updatedAt: user.updated_at ? new Date(user.updated_at) : undefined,
      identities:
        (user.identities as unknown as Array<Record<string, unknown>>) || [],
      rawClaims: {
        aud: user.aud,
        role: user.role,
        email: user.email,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata,
      },
    };
  }
}
