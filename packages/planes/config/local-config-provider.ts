import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigProvider } from './config-provider.interface';

/**
 * LocalConfigProvider — reads all config from NestJS ConfigService (process.env / .env files).
 * Selected when CONFIG_PROVIDER=local.
 */
@Injectable()
export class LocalConfigProvider implements ConfigProvider {
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  getRequired(key: string): string {
    const value = this.configService.get<string>(key);
    if (value === undefined || value === null || value.trim() === '') {
      throw new Error(`Missing required configuration key: ${key}`);
    }
    return value;
  }

  getOptional(key: string, defaultValue: string): string {
    return this.configService.get<string>(key) ?? defaultValue;
  }

  async getSecret(key: string): Promise<string> {
    await Promise.resolve();
    return this.getRequired(key);
  }

  async getSecretOptional(key: string, defaultValue: string): Promise<string> {
    await Promise.resolve();
    return this.getOptional(key, defaultValue);
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
    return { provider: 'local', source: 'process.env / .env files' };
  }
}
