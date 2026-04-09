import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigProvider } from './config-provider.interface';

/**
 * SupabaseVaultConfigProvider — reads secrets from Supabase Vault (pgsodium),
 * preloads them into process.env at startup so all existing ConfigService.get()
 * calls work transparently.
 *
 * Selected when CONFIG_PROVIDER=supabase_vault.
 *
 * On init:
 *   1. Connects to PostgreSQL using DATABASE_URL
 *   2. Queries vault.decrypted_secrets for all stored secrets
 *   3. Injects each secret into process.env (skips if env var already set)
 *
 * Secrets are stored via vault.create_secret(value, name, description).
 * The 'name' field should match the env var name (e.g. ANTHROPIC_API_KEY).
 *
 * This means the rest of the codebase doesn't need to change —
 * ConfigService.get('ANTHROPIC_API_KEY') returns the Vault value.
 */
@Injectable()
export class SupabaseVaultConfigProvider
  implements ConfigProvider, OnModuleInit
{
  private readonly logger = new Logger(SupabaseVaultConfigProvider.name);
  private readonly databaseUrl: string;
  private readonly secretCache = new Map<string, string>();

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    this.databaseUrl = this.configService.getOrThrow<string>('DATABASE_URL');
  }

  /**
   * Preload ALL secrets from Supabase Vault into process.env.
   * Env vars already set take precedence (allows local overrides).
   */
  async onModuleInit(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('pg') as typeof import('pg');
    const client = new Client({ connectionString: this.databaseUrl });

    try {
      await client.connect();
      this.logger.log('Supabase Vault: connected');

      const result = await client.query<{
        name: string;
        decrypted_secret: string;
      }>(
        'SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name IS NOT NULL',
      );

      let loaded = 0;
      let skipped = 0;

      for (const row of result.rows) {
        const envName = row.name;
        const secretValue = row.decrypted_secret;

        if (!envName || !secretValue) continue;

        // Don't overwrite env vars that are already set (local overrides win)
        if (
          process.env[envName] !== undefined &&
          process.env[envName] !== null &&
          process.env[envName]!.trim() !== ''
        ) {
          skipped++;
          continue;
        }

        process.env[envName] = secretValue;
        this.secretCache.set(envName, secretValue);
        loaded++;
      }

      this.logger.log(
        `Vault preload: ${loaded} secrets loaded, ${skipped} skipped (env override), ${result.rows.length} total in vault`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to Supabase Vault: ${message}`);
    } finally {
      await client.end();
    }
  }

  getRequired(key: string): string {
    const value = this.configService.get<string>(key);
    if (value !== undefined && value !== null && value.trim() !== '') {
      return value;
    }
    // Also check process.env directly (secrets injected after ConfigService init)
    const envValue = process.env[key];
    if (envValue !== undefined && envValue.trim() !== '') {
      return envValue;
    }
    throw new Error(
      `Missing required configuration key: ${key}. Not found in environment or Supabase Vault.`,
    );
  }

  getOptional(key: string, defaultValue: string): string {
    return (
      this.configService.get<string>(key) ?? process.env[key] ?? defaultValue
    );
  }

  async getSecret(key: string): Promise<string> {
    // Check cache first
    const cached = this.secretCache.get(key);
    if (cached !== undefined) return cached;

    // Check env vars (includes preloaded vault secrets)
    const envValue = process.env[key];
    if (envValue !== undefined && envValue.trim() !== '') {
      this.secretCache.set(key, envValue);
      return envValue;
    }

    // For Supabase Vault, all secrets are preloaded at startup.
    // If it's not in env by now, it doesn't exist.
    throw new Error(
      `Secret '${key}' not found in environment or Supabase Vault. ` +
        `Ensure it was added via: SELECT vault.create_secret('value', '${key}', 'description');`,
    );
  }

  async getSecretOptional(key: string, defaultValue: string): Promise<string> {
    try {
      return await this.getSecret(key);
    } catch {
      return defaultValue;
    }
  }

  getBoolean(key: string, defaultValue?: boolean): boolean {
    const raw = this.configService.get<string>(key) ?? process.env[key];
    if (raw === undefined || raw === null || raw.trim() === '') {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Missing required boolean configuration key: ${key}`);
    }
    const lower = raw.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
    throw new Error(
      `Invalid boolean value for key '${key}': '${raw}'. Expected: true/false, 1/0, yes/no`,
    );
  }

  getNumber(key: string, defaultValue?: number): number {
    const raw = this.configService.get<string>(key) ?? process.env[key];
    if (raw === undefined || raw === null || raw.trim() === '') {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Missing required number configuration key: ${key}`);
    }
    const num = Number(raw);
    if (isNaN(num)) {
      throw new Error(`Invalid number value for key '${key}': '${raw}'`);
    }
    return num;
  }

  getJson<T = unknown>(key: string, defaultValue?: T): T {
    const raw = this.configService.get<string>(key) ?? process.env[key];
    if (raw === undefined || raw === null || raw.trim() === '') {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Missing required JSON configuration key: ${key}`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Invalid JSON value for key '${key}': ${raw}`);
    }
  }

  validateRequired(keys: string[]): string[] {
    return keys.filter((key) => {
      const value = this.configService.get<string>(key) ?? process.env[key];
      return value === undefined || value === null || value.trim() === '';
    });
  }

  getProviderInfo(): { provider: string; source: string } {
    return {
      provider: 'supabase_vault',
      source: 'vault.decrypted_secrets (pgsodium)',
    };
  }
}
