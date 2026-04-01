import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SovereignPolicyService } from '../sovereign-policy.service';

function makeConfigService(
  envVars: Record<string, string> = {},
): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      return key in envVars ? envVars[key] : defaultValue;
    }),
  } as unknown as ConfigService;
}

describe('SovereignPolicyService', () => {
  let service: SovereignPolicyService;

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPolicy', () => {
    it('should return default policy when no env vars are set', () => {
      service = new SovereignPolicyService(makeConfigService());

      const policy = service.getPolicy();

      expect(policy.enforced).toBe(false);
      expect(policy.defaultMode).toBe('relaxed');
      expect(policy.auditLevel).toBe('basic');
      expect(policy.realtimeUpdates).toBe(true);
    });

    it('should read enforced=true from SOVEREIGN_MODE_ENFORCED env var', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_ENFORCED: 'true' }),
      );

      const policy = service.getPolicy();
      expect(policy.enforced).toBe(true);
    });

    it('should read strict defaultMode from SOVEREIGN_MODE_DEFAULT', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_DEFAULT: 'strict' }),
      );

      const policy = service.getPolicy();
      expect(policy.defaultMode).toBe('strict');
    });

    it('should default to relaxed when SOVEREIGN_MODE_DEFAULT is an invalid value', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_DEFAULT: 'invalid-value' }),
      );

      const policy = service.getPolicy();
      expect(policy.defaultMode).toBe('relaxed');
    });

    it('should read full auditLevel from SOVEREIGN_MODE_AUDIT_LEVEL', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_AUDIT_LEVEL: 'full' }),
      );

      const policy = service.getPolicy();
      expect(policy.auditLevel).toBe('full');
    });

    it('should default to basic when SOVEREIGN_MODE_AUDIT_LEVEL is invalid', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_AUDIT_LEVEL: 'ultra' }),
      );

      const policy = service.getPolicy();
      expect(policy.auditLevel).toBe('basic');
    });

    it('should read realtimeUpdates=false from SOVEREIGN_MODE_REALTIME_UPDATES', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_REALTIME_UPDATES: 'false' }),
      );

      const policy = service.getPolicy();
      expect(policy.realtimeUpdates).toBe(false);
    });

    it('should handle none audit level', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_AUDIT_LEVEL: 'none' }),
      );

      const policy = service.getPolicy();
      expect(policy.auditLevel).toBe('none');
    });
  });

  describe('isEnforced', () => {
    it('should return false by default', () => {
      service = new SovereignPolicyService(makeConfigService());
      expect(service.isEnforced()).toBe(false);
    });

    it('should return true when enforced is set', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_ENFORCED: 'true' }),
      );
      expect(service.isEnforced()).toBe(true);
    });
  });

  describe('getDefaultMode', () => {
    it('should return relaxed by default', () => {
      service = new SovereignPolicyService(makeConfigService());
      expect(service.getDefaultMode()).toBe('relaxed');
    });

    it('should return strict when configured', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_DEFAULT: 'strict' }),
      );
      expect(service.getDefaultMode()).toBe('strict');
    });
  });

  describe('getAuditLevel', () => {
    it('should return basic by default', () => {
      service = new SovereignPolicyService(makeConfigService());
      expect(service.getAuditLevel()).toBe('basic');
    });

    it('should return full when configured', () => {
      service = new SovereignPolicyService(
        makeConfigService({ SOVEREIGN_MODE_AUDIT_LEVEL: 'full' }),
      );
      expect(service.getAuditLevel()).toBe('full');
    });
  });

  describe('isProviderAllowed', () => {
    beforeEach(() => {
      service = new SovereignPolicyService(makeConfigService());
    });

    it('should allow ollama provider', () => {
      expect(service.isProviderAllowed('ollama')).toBe(true);
    });

    it('should allow ollama provider (uppercase)', () => {
      expect(service.isProviderAllowed('OLLAMA')).toBe(true);
    });

    it('should block openai provider in sovereign mode', () => {
      expect(service.isProviderAllowed('openai')).toBe(false);
    });

    it('should block anthropic provider in sovereign mode', () => {
      expect(service.isProviderAllowed('anthropic')).toBe(false);
    });

    it('should block google provider in sovereign mode', () => {
      expect(service.isProviderAllowed('google')).toBe(false);
    });
  });

  describe('validatePolicy', () => {
    it('should return valid with no warnings for default policy', () => {
      service = new SovereignPolicyService(makeConfigService());
      const result = service.validatePolicy();
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn when enforced=true but defaultMode=relaxed', () => {
      service = new SovereignPolicyService(
        makeConfigService({
          SOVEREIGN_MODE_ENFORCED: 'true',
          SOVEREIGN_MODE_DEFAULT: 'relaxed',
        }),
      );

      const result = service.validatePolicy();
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('enforced');
      expect(result.warnings[0]).toContain('relaxed');
    });

    it('should warn when enforced=true but auditLevel=none', () => {
      service = new SovereignPolicyService(
        makeConfigService({
          SOVEREIGN_MODE_ENFORCED: 'true',
          SOVEREIGN_MODE_DEFAULT: 'strict',
          SOVEREIGN_MODE_AUDIT_LEVEL: 'none',
        }),
      );

      const result = service.validatePolicy();
      expect(result.valid).toBe(false);
      const warningsText = result.warnings.join(' ');
      expect(warningsText).toContain('audit');
    });

    it('should produce two warnings when both issues exist', () => {
      service = new SovereignPolicyService(
        makeConfigService({
          SOVEREIGN_MODE_ENFORCED: 'true',
          SOVEREIGN_MODE_DEFAULT: 'relaxed',
          SOVEREIGN_MODE_AUDIT_LEVEL: 'none',
        }),
      );

      const result = service.validatePolicy();
      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(2);
    });

    it('should be valid with enforced=true and strict mode + basic audit', () => {
      service = new SovereignPolicyService(
        makeConfigService({
          SOVEREIGN_MODE_ENFORCED: 'true',
          SOVEREIGN_MODE_DEFAULT: 'strict',
          SOVEREIGN_MODE_AUDIT_LEVEL: 'basic',
        }),
      );

      const result = service.validatePolicy();
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('NestJS DI integration', () => {
    it('should be injectable via Test.createTestingModule', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SovereignPolicyService,
          {
            provide: ConfigService,
            useValue: makeConfigService({
              SOVEREIGN_MODE_ENFORCED: 'false',
            }),
          },
        ],
      }).compile();

      const svc = module.get<SovereignPolicyService>(SovereignPolicyService);
      expect(svc).toBeDefined();
      expect(svc.isEnforced()).toBe(false);
    });
  });
});
