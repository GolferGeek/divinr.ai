import { Injectable, Logger } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { SupabaseService } from '../../database/supabase-client.service';

interface IdentityLinkRow {
  user_id: string;
}

/**
 * Maps external OIDC principals to internal user IDs via authz.auth_identity_links.
 */
@Injectable()
export class InternalIdentityLinkService {
  private readonly logger = new Logger(InternalIdentityLinkService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async findInternalUserId(
    principal: AuthenticatedPrincipal,
  ): Promise<string | null> {
    const client = this.supabaseService.getServiceClient();
    const { data, error } = await client
      .schema('authz')
      .from('auth_identity_links')
      .select('user_id')
      .eq('issuer', principal.issuer)
      .eq('subject', principal.subject)
      .maybeSingle<IdentityLinkRow>();

    if (error) {
      throw new Error(`Failed to resolve identity link: ${error.message}`);
    }

    return data?.user_id ?? null;
  }

  async upsertIdentityLink(
    userId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const client = this.supabaseService.getServiceClient();
    const { error } = await client
      .schema('authz')
      .from('auth_identity_links')
      .upsert(
        {
          user_id: userId,
          issuer: principal.issuer,
          subject: principal.subject,
          email: principal.email ?? null,
          raw_claims: principal.rawClaims,
        },
        {
          onConflict: 'issuer,subject',
        },
      );

    if (error) {
      throw new Error(`Failed to upsert identity link: ${error.message}`);
    }

    this.logger.debug(
      `Identity link upserted for issuer=${principal.issuer} subject=${principal.subject}`,
    );
  }
}
