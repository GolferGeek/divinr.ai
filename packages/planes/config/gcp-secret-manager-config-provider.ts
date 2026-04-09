import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigProvider } from './config-provider.interface';

// Lazy-loaded GCP Secret Manager client to allow the module to load even when
// @google-cloud/secret-manager is not installed at import time.
interface SecretManagerPayload {
  data?: Buffer | { toString(): string };
}
interface SecretManagerAccessResponse {
  payload?: SecretManagerPayload;
}
interface SecretManagerServiceClientInterface {
  accessSecretVersion(params: {
    name: string;
  }): Promise<[SecretManagerAccessResponse]>;
}
type SecretManagerClient = SecretManagerServiceClientInterface;

/**
 * GcpSecretManagerConfigProvider — reads secrets from GCP Secret Manager,
 * falls back to env vars for non-secret configuration.
 *
 * Selected when CONFIG_PROVIDER=gcp_secret_manager.
 *
 * Secret Manager secret names use hyphens (e.g., anthropic-api-key)
 * while env var names use underscores (e.g., ANTHROPIC_API_KEY).
 * This provider normalizes between the two conventions.
 */
@Injectable()
export class GcpSecretManagerConfigProvider
  implements ConfigProvider, OnModuleInit
{
  private readonly logger = new Logger(GcpSecretManagerConfigProvider.name);
  private readonly client: SecretManagerClient;
  private readonly secretCache = new Map<string, string>();
  private readonly projectId: string;

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    this.projectId = this.configService.getOrThrow<string>('GCP_PROJECT_ID');

    /* eslint-disable @typescript-eslint/no-require-imports */
    const { SecretManagerServiceClient } =
      require('@google-cloud/secret-manager') as {
        SecretManagerServiceClient: new () => SecretManagerServiceClientInterface;
      };
    /* eslint-enable @typescript-eslint/no-require-imports */
    this.client = new SecretManagerServiceClient();
  }

  onModuleInit(): void {
    this.logger.log(`GCP Secret Manager connected: projects/${this.projectId}`);
  }

  getRequired(key: string): string {
    const value = this.configService.get<string>(key);
    if (value !== undefined && value !== null && value.trim() !== '') {
      return value;
    }
    throw new Error(
      `Missing required configuration key: ${key}. Not found in environment. For secrets, use getSecret() instead.`,
    );
  }

  getOptional(key: string, defaultValue: string): string {
    return this.configService.get<string>(key) ?? defaultValue;
  }

  async getSecret(key: string): Promise<string> {
    // Check cache first
    const cached = this.secretCache.get(key);
    if (cached !== undefined) return cached;

    // Check env vars (allows overrides)
    const envValue = this.configService.get<string>(key);
    if (envValue !== undefined && envValue !== null && envValue.trim() !== '') {
      this.secretCache.set(key, envValue);
      return envValue;
    }

    // Fetch from Secret Manager
    const secretName = this.toSecretManagerName(key);
    try {
      const [response]: [SecretManagerAccessResponse] =
        await this.client.accessSecretVersion({
          name: secretName,
        });
      const secretValue = response.payload?.data?.toString();
      if (!secretValue) {
        throw new Error(
          `Secret '${secretName}' exists in Secret Manager but has no value`,
        );
      }
      this.secretCache.set(key, secretValue);
      return secretValue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to retrieve secret '${key}' (secret name: '${secretName}') from GCP Secret Manager: ${message}`,
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
    const raw = this.configService.get<string>(key);
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
    const raw = this.configService.get<string>(key);
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
    const raw = this.configService.get<string>(key);
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
      const value = this.configService.get<string>(key);
      return value === undefined || value === null || value.trim() === '';
    });
  }

  getProviderInfo(): { provider: string; source: string } {
    return {
      provider: 'gcp_secret_manager',
      source: `projects/${this.projectId}`,
    };
  }

  /**
   * Convert env var name to GCP Secret Manager secret resource name.
   * Secret names use hyphens and lowercase: ANTHROPIC_API_KEY -> anthropic-api-key
   * Full resource path: projects/{project}/secrets/{name}/versions/latest
   */
  private toSecretManagerName(key: string): string {
    const secretId = key.replace(/_/g, '-').toLowerCase();
    return `projects/${this.projectId}/secrets/${secretId}/versions/latest`;
  }
}
