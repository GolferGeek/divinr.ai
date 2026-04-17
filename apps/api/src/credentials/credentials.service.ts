import { Injectable, Inject, Logger, ConflictException } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { CredentialsSchemaService } from './credentials-schema.service';
import { CredentialEncryptionService } from './credential-encryption.service';
import { BillingService } from '../billing/billing.service';

export interface CredentialSummary {
  id: string;
  provider: string;
  label: string;
  lastUsedAt: string | null;
}

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(CredentialsSchemaService) private readonly schema: CredentialsSchemaService,
    @Inject(CredentialEncryptionService) private readonly encryption: CredentialEncryptionService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  async addCredential(
    userId: string,
    input: { provider: string; label: string; secret: string },
  ): Promise<CredentialSummary> {
    await this.schema.ensureSchema();

    const { ciphertext, iv, tag } = this.encryption.encrypt(input.secret);

    const result = await this.db.rawQuery(
      `INSERT INTO credentials.user_llm_credentials
         (user_id, provider, label, encrypted_secret, encryption_iv, encryption_tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, provider, label, last_used_at`,
      [userId, input.provider, input.label, ciphertext, iv, tag],
    );
    if (result.error) throw new Error(`addCredential failed: ${result.error.message}`);
    const rows = (result.data as any[]) ?? [];
    const row = rows[0];

    // Check if this is the first active credential → add byo_platform_fee
    const countResult = await this.db.rawQuery(
      `SELECT count(*)::int AS cnt FROM credentials.user_llm_credentials
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    const count = ((countResult.data as any[])?.[0]?.cnt ?? 0) as number;
    if (count === 1) {
      try {
        await this.billing.addAuthoredItem(userId, 'byo_platform_fee', null);
        this.logger.log(`BYO platform fee added for user ${userId}`);
      } catch (err: any) {
        this.logger.warn(`Failed to add byo_platform_fee billing item: ${err.message}`);
      }
    }

    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      lastUsedAt: row.last_used_at ?? null,
    };
  }

  async listCredentials(userId: string): Promise<CredentialSummary[]> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT id, provider, label, last_used_at
       FROM credentials.user_llm_credentials
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at`,
      [userId],
    );
    if (result.error) throw new Error(`listCredentials failed: ${result.error.message}`);
    return ((result.data as any[]) ?? []).map((r: any) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      lastUsedAt: r.last_used_at ?? null,
    }));
  }

  async revokeCredential(userId: string, credentialId: string): Promise<void> {
    await this.schema.ensureSchema();

    // Check if any analyst still references this credential
    const refResult = await this.db.rawQuery(
      `SELECT id FROM prediction.market_analysts
       WHERE byo_credential_id = $1 AND is_active = true
       LIMIT 1`,
      [credentialId],
    );
    if (refResult.error) throw new Error(`revokeCredential ref-check failed: ${refResult.error.message}`);
    if (((refResult.data as any[]) ?? []).length > 0) {
      throw new ConflictException(
        'Cannot revoke credential: one or more analysts still reference it. Remove the BYO assignment first.',
      );
    }

    const result = await this.db.rawQuery(
      `UPDATE credentials.user_llm_credentials
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [credentialId, userId],
    );
    if (result.error) throw new Error(`revokeCredential failed: ${result.error.message}`);

    // If no active credentials remain, cancel byo_platform_fee
    const countResult = await this.db.rawQuery(
      `SELECT count(*)::int AS cnt FROM credentials.user_llm_credentials
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    const count = ((countResult.data as any[])?.[0]?.cnt ?? 0) as number;
    if (count === 0) {
      try {
        await this.billing.cancelAuthoredItem(userId, 'byo_platform_fee', null);
        this.logger.log(`BYO platform fee canceled for user ${userId}`);
      } catch (err: any) {
        this.logger.warn(`Failed to cancel byo_platform_fee billing item: ${err.message}`);
      }
    }
  }

  async resolveSecret(credentialId: string, userId?: string): Promise<{ provider: string; secret: string }> {
    await this.schema.ensureSchema();
    const sql = userId
      ? `SELECT provider, encrypted_secret, encryption_iv, encryption_tag
         FROM credentials.user_llm_credentials
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`
      : `SELECT provider, encrypted_secret, encryption_iv, encryption_tag
         FROM credentials.user_llm_credentials
         WHERE id = $1 AND revoked_at IS NULL`;
    const params = userId ? [credentialId, userId] : [credentialId];
    const result = await this.db.rawQuery(sql, params);
    if (result.error) throw new Error(`resolveSecret failed: ${result.error.message}`);
    const rows = (result.data as any[]) ?? [];
    if (rows.length === 0) throw new Error(`Credential ${credentialId} not found or revoked`);

    const row = rows[0];
    const secret = this.encryption.decrypt(
      Buffer.from(row.encrypted_secret),
      Buffer.from(row.encryption_iv),
      Buffer.from(row.encryption_tag),
    );

    // Update last_used_at
    await this.db.rawQuery(
      `UPDATE credentials.user_llm_credentials SET last_used_at = now() WHERE id = $1`,
      [credentialId],
    );

    return { provider: row.provider, secret };
  }
}
