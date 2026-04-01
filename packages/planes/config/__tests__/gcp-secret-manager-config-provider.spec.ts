import { GcpSecretManagerConfigProvider } from '../gcp-secret-manager-config-provider';
import { ConfigService } from '@nestjs/config';

// Mock GCP Secret Manager SDK (mapped to __mocks__/@google-cloud/secret-manager.js in jest.config.js)
jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
    accessSecretVersion: jest.fn(),
  })),
}));

describe('GcpSecretManagerConfigProvider', () => {
  let provider: GcpSecretManagerConfigProvider;
  let mockAccessSecretVersion: jest.Mock;
  let configValues: Record<string, string | undefined>;

  beforeEach(() => {
    configValues = {
      GCP_PROJECT_ID: 'test-gcp-project',
      API_PORT: '6100',
      NODE_ENV: 'development',
      ANTHROPIC_API_KEY: 'sk-ant-from-env',
      FEATURE_ENABLED: 'true',
      MAX_RETRIES: '3',
      MODEL_CONFIG: '{"provider":"openai","model":"gpt-4o"}',
    };

    const configService = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        if (configValues[key] === undefined) throw new Error(`Missing ${key}`);
        return configValues[key];
      }),
    } as unknown as ConfigService;

    provider = new GcpSecretManagerConfigProvider(configService);

    // Replace the client with our controllable mock
    mockAccessSecretVersion = jest.fn();
    (provider as any).client = {
      accessSecretVersion: mockAccessSecretVersion,
    };
  });

  describe('getRequired', () => {
    it('returns env value when present', () => {
      expect(provider.getRequired('API_PORT')).toBe('6100');
    });

    it('throws when key is missing from env', () => {
      expect(() => provider.getRequired('MISSING_KEY')).toThrow(
        'Missing required configuration key: MISSING_KEY',
      );
    });
  });

  describe('getOptional', () => {
    it('returns env value when present', () => {
      expect(provider.getOptional('API_PORT', '8080')).toBe('6100');
    });

    it('returns default when missing', () => {
      expect(provider.getOptional('MISSING', '8080')).toBe('8080');
    });
  });

  describe('getSecret', () => {
    it('returns env var if present (env override)', async () => {
      const result = await provider.getSecret('ANTHROPIC_API_KEY');
      expect(result).toBe('sk-ant-from-env');
      expect(mockAccessSecretVersion).not.toHaveBeenCalled();
    });

    it('fetches from Secret Manager when not in env', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([
        {
          payload: { data: Buffer.from('sk-ant-from-gcp') },
        },
      ]);

      delete configValues.ANTHROPIC_API_KEY;

      const result = await provider.getSecret('ANTHROPIC_API_KEY');
      expect(result).toBe('sk-ant-from-gcp');
      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/test-gcp-project/secrets/anthropic-api-key/versions/latest',
      });
    });

    it('caches secrets after first fetch', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([
        {
          payload: { data: Buffer.from('cached-secret') },
        },
      ]);
      delete configValues.MY_SECRET;

      await provider.getSecret('MY_SECRET');
      await provider.getSecret('MY_SECRET');

      // Only called once due to caching
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
    });

    it('throws when secret not found in Secret Manager', async () => {
      mockAccessSecretVersion.mockRejectedValueOnce(
        new Error('NOT_FOUND: Secret not found'),
      );
      delete configValues.MISSING_SECRET;

      await expect(provider.getSecret('MISSING_SECRET')).rejects.toThrow(
        "Failed to retrieve secret 'MISSING_SECRET' (secret name: 'projects/test-gcp-project/secrets/missing-secret/versions/latest') from GCP Secret Manager",
      );
    });

    it('throws when secret has no value', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([
        {
          payload: { data: null },
        },
      ]);
      delete configValues.EMPTY_SECRET;

      await expect(provider.getSecret('EMPTY_SECRET')).rejects.toThrow(
        'has no value',
      );
    });
  });

  describe('getSecretOptional', () => {
    it('returns default when secret not available', async () => {
      mockAccessSecretVersion.mockRejectedValueOnce(new Error('not found'));
      delete configValues.MISSING;

      const result = await provider.getSecretOptional('MISSING', 'default-val');
      expect(result).toBe('default-val');
    });
  });

  describe('getBoolean', () => {
    it('parses true', () => {
      expect(provider.getBoolean('FEATURE_ENABLED')).toBe(true);
    });

    it('returns default when missing', () => {
      expect(provider.getBoolean('MISSING', false)).toBe(false);
    });

    it('throws when missing with no default', () => {
      expect(() => provider.getBoolean('MISSING')).toThrow(
        'Missing required boolean configuration key: MISSING',
      );
    });
  });

  describe('getNumber', () => {
    it('parses numbers', () => {
      expect(provider.getNumber('MAX_RETRIES')).toBe(3);
    });

    it('returns default when missing', () => {
      expect(provider.getNumber('MISSING', 10)).toBe(10);
    });

    it('throws on invalid number', () => {
      configValues.BAD_NUM = 'not-a-number';
      expect(() => provider.getNumber('BAD_NUM')).toThrow(
        "Invalid number value for key 'BAD_NUM'",
      );
    });
  });

  describe('getJson', () => {
    it('parses JSON', () => {
      const result = provider.getJson<{ provider: string }>('MODEL_CONFIG');
      expect(result.provider).toBe('openai');
    });

    it('returns default when missing', () => {
      const result = provider.getJson('MISSING', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('throws on invalid JSON', () => {
      configValues.BAD_JSON = 'not-json{';
      expect(() => provider.getJson('BAD_JSON')).toThrow(
        "Invalid JSON value for key 'BAD_JSON'",
      );
    });
  });

  describe('validateRequired', () => {
    it('identifies missing keys', () => {
      const missing = provider.validateRequired(['API_PORT', 'MISSING_KEY']);
      expect(missing).toEqual(['MISSING_KEY']);
    });
  });

  describe('getProviderInfo', () => {
    it('returns gcp_secret_manager provider info', () => {
      const info = provider.getProviderInfo();
      expect(info.provider).toBe('gcp_secret_manager');
      expect(info.source).toBe('projects/test-gcp-project');
    });
  });

  describe('secret name conversion', () => {
    it('converts underscores to hyphens and lowercases', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([
        {
          payload: { data: Buffer.from('secret-value') },
        },
      ]);
      delete configValues.ANTHROPIC_API_KEY;

      await provider.getSecret('ANTHROPIC_API_KEY');
      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/test-gcp-project/secrets/anthropic-api-key/versions/latest',
      });
    });
  });
});
