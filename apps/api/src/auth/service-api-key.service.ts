import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface ServiceApiKey {
  id: string;
  key_prefix: string;
  key_hash: string;
  label: string;
  allowed_machine_identities: string[];
  scopes: string[];
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

@Injectable()
export class ServiceApiKeyService implements OnModuleInit {
  private readonly logger = new Logger(ServiceApiKeyService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS prediction.service_api_keys (
        id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        key_prefix      text NOT NULL,
        key_hash        text NOT NULL UNIQUE,
        label           text NOT NULL,
        allowed_machine_identities text[] NOT NULL DEFAULT '{}',
        scopes          text[] NOT NULL DEFAULT '{*}',
        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),
        last_used_at    timestamptz,
        revoked_at      timestamptz
      );
    `;
    const result = await this.db.rawQuery(ddl);
    if (result.error) {
      this.logger.error(`Failed to create service_api_keys table: ${result.error.message}`);
    }
  }

  /**
   * Generate a new service API key. Returns the full key (only shown once).
   */
  async generateKey(
    label: string,
    allowedMachineIdentities: string[],
    scopes: string[] = ['*'],
  ): Promise<{ key: string; id: string; prefix: string }> {
    const raw = randomBytes(32).toString('hex');
    const key = `div_sk_${raw}`;
    const prefix = `div_sk_${raw.slice(0, 8)}...`;
    const hash = this.hashKey(key);

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.service_api_keys
        (key_prefix, key_hash, label, allowed_machine_identities, scopes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [prefix, hash, label, allowedMachineIdentities, scopes],
    );

    if (result.error) throw new Error(`Failed to create API key: ${result.error.message}`);
    const rows = (result.data as Array<{ id: string }>) ?? [];
    return { key, id: rows[0].id, prefix };
  }

  /**
   * Validate a key + machine identity. Returns the key record if valid, null otherwise.
   */
  async validate(
    key: string,
    machineIdentity: string | undefined,
  ): Promise<ServiceApiKey | null> {
    if (!key.startsWith('div_sk_')) return null;

    const hash = this.hashKey(key);
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.service_api_keys
       WHERE key_hash = $1 AND is_active = true AND revoked_at IS NULL`,
      [hash],
    );

    if (result.error) {
      this.logger.error(`Key validation query failed: ${result.error.message}`);
      return null;
    }

    const rows = (result.data as ServiceApiKey[] | null) ?? [];
    if (rows.length === 0) return null;

    const record = rows[0];

    // Check machine identity
    if (record.allowed_machine_identities.length > 0) {
      if (!machineIdentity || !record.allowed_machine_identities.includes(machineIdentity)) {
        this.logger.warn(
          `API key ${record.key_prefix} rejected: machine identity "${machineIdentity}" not in allowed list`,
        );
        return null;
      }
    }

    // Update last_used_at (fire-and-forget)
    this.db.rawQuery(
      `UPDATE prediction.service_api_keys SET last_used_at = now() WHERE id = $1`,
      [record.id],
    ).catch(() => {});

    return record;
  }

  /**
   * Revoke a key by ID.
   */
  async revokeKey(id: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `UPDATE prediction.service_api_keys
       SET is_active = false, revoked_at = now()
       WHERE id = $1
       RETURNING id`,
      [id],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as unknown[]) ?? []).length > 0;
  }

  /**
   * List all keys (without hashes).
   */
  async listKeys(): Promise<Array<Omit<ServiceApiKey, 'key_hash'>>> {
    const result = await this.db.rawQuery(
      `SELECT id, key_prefix, label, allowed_machine_identities, scopes,
              is_active, created_at, last_used_at, revoked_at
       FROM prediction.service_api_keys
       ORDER BY created_at DESC`,
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<Omit<ServiceApiKey, 'key_hash'>>) ?? [];
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}
