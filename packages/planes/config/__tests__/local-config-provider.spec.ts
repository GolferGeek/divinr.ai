import { LocalConfigProvider } from '../local-config-provider';
import { ConfigService } from '@nestjs/config';

describe('LocalConfigProvider', () => {
  let provider: LocalConfigProvider;
  let configValues: Record<string, string | undefined>;

  beforeEach(() => {
    configValues = {
      API_PORT: '6100',
      NODE_ENV: 'development',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      FEATURE_ENABLED: 'true',
      MAX_RETRIES: '3',
      MODEL_CONFIG: '{"provider":"openai","model":"gpt-4o"}',
      EMPTY_VALUE: '',
      WHITESPACE_VALUE: '   ',
    };

    const configService = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        if (configValues[key] === undefined) throw new Error(`Missing ${key}`);
        return configValues[key];
      }),
    } as unknown as ConfigService;

    provider = new LocalConfigProvider(configService);
  });

  describe('getRequired', () => {
    it('returns value when key exists', () => {
      expect(provider.getRequired('API_PORT')).toBe('6100');
    });

    it('throws when key is missing', () => {
      expect(() => provider.getRequired('MISSING_KEY')).toThrow(
        'Missing required configuration key: MISSING_KEY',
      );
    });

    it('throws when key is empty string', () => {
      expect(() => provider.getRequired('EMPTY_VALUE')).toThrow(
        'Missing required configuration key: EMPTY_VALUE',
      );
    });

    it('throws when key is whitespace', () => {
      expect(() => provider.getRequired('WHITESPACE_VALUE')).toThrow(
        'Missing required configuration key: WHITESPACE_VALUE',
      );
    });
  });

  describe('getOptional', () => {
    it('returns value when key exists', () => {
      expect(provider.getOptional('API_PORT', '8080')).toBe('6100');
    });

    it('returns default when key is missing', () => {
      expect(provider.getOptional('MISSING_KEY', '8080')).toBe('8080');
    });
  });

  describe('getSecret / getSecretOptional', () => {
    it('getSecret returns env var value', async () => {
      const result = await provider.getSecret('ANTHROPIC_API_KEY');
      expect(result).toBe('sk-ant-test');
    });

    it('getSecret throws when missing', async () => {
      await expect(provider.getSecret('MISSING_SECRET')).rejects.toThrow(
        'Missing required configuration key: MISSING_SECRET',
      );
    });

    it('getSecretOptional returns default when missing', async () => {
      const result = await provider.getSecretOptional(
        'MISSING_SECRET',
        'fallback',
      );
      expect(result).toBe('fallback');
    });
  });

  describe('getBoolean', () => {
    it('parses true values', () => {
      configValues.B1 = 'true';
      configValues.B2 = '1';
      configValues.B3 = 'yes';
      configValues.B4 = 'TRUE';
      expect(provider.getBoolean('B1')).toBe(true);
      expect(provider.getBoolean('B2')).toBe(true);
      expect(provider.getBoolean('B3')).toBe(true);
      expect(provider.getBoolean('B4')).toBe(true);
    });

    it('parses false values', () => {
      configValues.B1 = 'false';
      configValues.B2 = '0';
      configValues.B3 = 'no';
      expect(provider.getBoolean('B1')).toBe(false);
      expect(provider.getBoolean('B2')).toBe(false);
      expect(provider.getBoolean('B3')).toBe(false);
    });

    it('returns default when missing', () => {
      expect(provider.getBoolean('MISSING', true)).toBe(true);
      expect(provider.getBoolean('MISSING', false)).toBe(false);
    });

    it('throws when missing without default', () => {
      expect(() => provider.getBoolean('MISSING')).toThrow(
        'Missing required boolean configuration key: MISSING',
      );
    });

    it('throws on invalid boolean', () => {
      configValues.BAD = 'maybe';
      expect(() => provider.getBoolean('BAD')).toThrow(
        "Invalid boolean value for key 'BAD': 'maybe'",
      );
    });
  });

  describe('getNumber', () => {
    it('parses valid numbers', () => {
      expect(provider.getNumber('MAX_RETRIES')).toBe(3);
      expect(provider.getNumber('API_PORT')).toBe(6100);
    });

    it('returns default when missing', () => {
      expect(provider.getNumber('MISSING', 42)).toBe(42);
    });

    it('throws when missing without default', () => {
      expect(() => provider.getNumber('MISSING')).toThrow(
        'Missing required number configuration key: MISSING',
      );
    });

    it('throws on invalid number', () => {
      configValues.BAD_NUM = 'not-a-number';
      expect(() => provider.getNumber('BAD_NUM')).toThrow(
        "Invalid number value for key 'BAD_NUM': 'not-a-number'",
      );
    });
  });

  describe('getJson', () => {
    it('parses valid JSON', () => {
      const result = provider.getJson<{ provider: string; model: string }>(
        'MODEL_CONFIG',
      );
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('returns default when missing', () => {
      const def = { provider: 'ollama' };
      expect(provider.getJson('MISSING', def)).toEqual(def);
    });

    it('throws when missing without default', () => {
      expect(() => provider.getJson('MISSING')).toThrow(
        'Missing required JSON configuration key: MISSING',
      );
    });

    it('throws on invalid JSON', () => {
      configValues.BAD_JSON = '{not json';
      expect(() => provider.getJson('BAD_JSON')).toThrow(
        "Invalid JSON value for key 'BAD_JSON'",
      );
    });
  });

  describe('validateRequired', () => {
    it('returns empty array when all keys present', () => {
      const missing = provider.validateRequired(['API_PORT', 'NODE_ENV']);
      expect(missing).toEqual([]);
    });

    it('returns missing keys', () => {
      const missing = provider.validateRequired([
        'API_PORT',
        'MISSING_KEY',
        'ANOTHER_MISSING',
      ]);
      expect(missing).toEqual(['MISSING_KEY', 'ANOTHER_MISSING']);
    });

    it('treats empty and whitespace values as missing', () => {
      const missing = provider.validateRequired([
        'EMPTY_VALUE',
        'WHITESPACE_VALUE',
      ]);
      expect(missing).toEqual(['EMPTY_VALUE', 'WHITESPACE_VALUE']);
    });
  });

  describe('getProviderInfo', () => {
    it('returns local provider info', () => {
      const info = provider.getProviderInfo();
      expect(info.provider).toBe('local');
      expect(info.source).toContain('.env');
    });
  });
});
