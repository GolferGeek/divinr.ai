/**
 * Contract parity tests: verify that LocalConfigProvider and
 * AzureKeyVaultConfigProvider implement the same ConfigProvider
 * interface with equivalent behavior for synchronous operations.
 */
import { ConfigProvider } from '../config-provider.interface';
import { LocalConfigProvider } from '../local-config-provider';
import { AzureKeyVaultConfigProvider } from '../azure-keyvault-config-provider';
import { ConfigService } from '@nestjs/config';

jest.mock('@azure/keyvault-secrets', () => ({
  SecretClient: jest.fn().mockImplementation(() => ({
    getSecret: jest.fn(),
  })),
}));

jest.mock('@azure/identity', () => ({
  ManagedIdentityCredential: jest.fn(),
}));

interface ContractHarness {
  provider: ConfigProvider;
  setValues: (values: Record<string, string | undefined>) => void;
}

function createLocalHarness(): ContractHarness {
  const values: Record<string, string | undefined> = {};

  const configService = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;

  return {
    provider: new LocalConfigProvider(configService),
    setValues: (v) => Object.assign(values, v),
  };
}

function createAzureHarness(): ContractHarness {
  const values: Record<string, string | undefined> = {
    AZURE_KEYVAULT_URL: 'https://test.vault.azure.net/',
  };

  const configService = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;

  return {
    provider: new AzureKeyVaultConfigProvider(configService),
    setValues: (v) => Object.assign(values, v),
  };
}

describe.each([
  ['local', createLocalHarness],
  ['azure_keyvault', createAzureHarness],
])('ConfigProvider contract parity (%s)', (_name, makeHarness) => {
  let harness: ContractHarness;

  beforeEach(() => {
    harness = makeHarness();
    harness.setValues({
      APP_NAME: 'orchestrator',
      PORT: '6100',
      ENABLED: 'true',
      COUNT: '5',
      CONFIG_JSON: '{"key":"value"}',
    });
  });

  it('getRequired returns existing value', () => {
    expect(harness.provider.getRequired('APP_NAME')).toBe('orchestrator');
  });

  it('getRequired throws for missing key', () => {
    expect(() => harness.provider.getRequired('MISSING')).toThrow(/MISSING/);
  });

  it('getOptional returns value when present', () => {
    expect(harness.provider.getOptional('APP_NAME', 'default')).toBe(
      'orchestrator',
    );
  });

  it('getOptional returns default when missing', () => {
    expect(harness.provider.getOptional('MISSING', 'default')).toBe('default');
  });

  it('getBoolean parses true', () => {
    expect(harness.provider.getBoolean('ENABLED')).toBe(true);
  });

  it('getBoolean returns default when missing', () => {
    expect(harness.provider.getBoolean('MISSING', false)).toBe(false);
  });

  it('getNumber parses integer', () => {
    expect(harness.provider.getNumber('COUNT')).toBe(5);
  });

  it('getNumber returns default when missing', () => {
    expect(harness.provider.getNumber('MISSING', 42)).toBe(42);
  });

  it('getJson parses object', () => {
    const result = harness.provider.getJson<{ key: string }>('CONFIG_JSON');
    expect(result.key).toBe('value');
  });

  it('validateRequired identifies missing keys', () => {
    const missing = harness.provider.validateRequired([
      'APP_NAME',
      'MISSING_A',
      'MISSING_B',
    ]);
    expect(missing).toEqual(['MISSING_A', 'MISSING_B']);
  });

  it('getProviderInfo returns provider metadata', () => {
    const info = harness.provider.getProviderInfo();
    expect(info.provider).toBeDefined();
    expect(typeof info.source).toBe('string');
  });
});
