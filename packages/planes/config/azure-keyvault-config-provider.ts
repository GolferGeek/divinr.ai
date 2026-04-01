import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretClient } from '@azure/keyvault-secrets';
import { ManagedIdentityCredential } from '@azure/identity';
import { ConfigProvider } from './config-provider.interface';

/**
 * AzureKeyVaultConfigProvider — reads secrets from Azure Key Vault
 * and injects them into process.env at startup so all existing
 * ConfigService.get() calls work transparently.
 *
 * Selected when CONFIG_PROVIDER=azure_keyvault.
 *
 * On init:
 *   1. Lists every secret in the vault
 *   2. Fetches each value
 *   3. Converts vault name to env var name: google-api-key → GOOGLE_API_KEY
 *   4. Sets process.env[envName] = value (skips if env var already set)
 *
 * This means the rest of the codebase doesn't need to change —
 * ConfigService.get('GOOGLE_API_KEY') returns the Key Vault value.
 */
@Injectable()
export class AzureKeyVaultConfigProvider
  implements ConfigProvider, OnModuleInit
{
  private readonly logger = new Logger(AzureKeyVaultConfigProvider.name);
  private secretClient: SecretClient;
  private readonly secretCache = new Map<string, string>();
  private readonly vaultUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.vaultUrl = this.configService.getOrThrow<string>('AZURE_KEYVAULT_URL');
    // Use ManagedIdentityCredential directly (system-assigned).
    // DefaultAzureCredential picks up AZURE_CLIENT_ID from env and
    // misinterprets it as a User-Assigned identity client ID, but our
    // Container App uses System-Assigned identity.
    const credential = new ManagedIdentityCredential();
    this.secretClient = new SecretClient(this.vaultUrl, credential);
  }

  /**
   * Preload ALL secrets from Key Vault into process.env.
   * Env vars already set take precedence (allows local overrides).
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(`Azure Key Vault: ${this.vaultUrl}`);

    let loaded = 0;
    let skipped = 0;
    const errors: string[] = [];

    // List all secrets in the vault
    const secretNames: string[] = [];
    for await (const secretProperties of this.secretClient.listPropertiesOfSecrets()) {
      if (secretProperties.enabled) {
        secretNames.push(secretProperties.name);
      }
    }

    // Fetch each secret and inject into process.env
    for (const vaultName of secretNames) {
      const envName = this.toEnvVarName(vaultName);

      // Don't overwrite env vars that are already set (local overrides win)
      if (
        process.env[envName] !== undefined &&
        process.env[envName] !== null &&
        process.env[envName]!.trim() !== ''
      ) {
        skipped++;
        continue;
      }

      try {
        const secret = await this.secretClient.getSecret(vaultName);
        if (secret.value) {
          process.env[envName] = secret.value;
          this.secretCache.set(envName, secret.value);
          loaded++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${vaultName}: ${message}`);
      }
    }

    this.logger.log(
      `Key Vault preload: ${loaded} secrets loaded, ${skipped} skipped (env override), ${errors.length} errors`,
    );
    if (errors.length > 0) {
      this.logger.warn(`Key Vault errors: ${errors.join('; ')}`);
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
      `Missing required configuration key: ${key}. Not found in environment or Key Vault.`,
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

    // Fetch from Key Vault on-demand (for secrets not in the initial list)
    const vaultName = this.toVaultSecretName(key);
    try {
      const secret = await this.secretClient.getSecret(vaultName);
      if (!secret.value) {
        throw new Error(
          `Secret '${vaultName}' exists in Key Vault but has no value`,
        );
      }
      this.secretCache.set(key, secret.value);
      process.env[key] = secret.value; // Also inject for ConfigService
      return secret.value;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to retrieve secret '${key}' (vault name: '${vaultName}') from Azure Key Vault: ${message}`,
      );
    }
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
    return { provider: 'azure_keyvault', source: this.vaultUrl };
  }

  /**
   * Convert env var name to Azure Key Vault secret name.
   * Key Vault names can only contain alphanumeric characters and hyphens.
   * GOOGLE_API_KEY → google-api-key
   */
  private toVaultSecretName(key: string): string {
    return key.replace(/_/g, '-').toLowerCase();
  }

  /**
   * Convert Azure Key Vault secret name back to env var name.
   * google-api-key → GOOGLE_API_KEY
   */
  private toEnvVarName(vaultName: string): string {
    return vaultName.replace(/-/g, '_').toUpperCase();
  }
}
