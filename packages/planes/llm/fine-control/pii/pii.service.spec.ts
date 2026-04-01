import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Logger as _Logger } from '@nestjs/common';
import { PIIService } from './pii.service';
import { DATABASE_SERVICE } from '@/database';
import { PIIPatternService } from '../pii-pattern.service';
import type { PIIProcessingMetadata as _PIIProcessingMetadata } from '../types/pii-metadata.types';

describe('PIIService', () => {
  let service: PIIService;
  let mockPIIPatternService: jest.Mocked<PIIPatternService>;

  beforeEach(async () => {
    // Create mock services
    mockPIIPatternService = {
      detectPII: jest.fn(),
    } as unknown as jest.Mocked<PIIPatternService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PIIService,
        {
          provide: DATABASE_SERVICE,
          useValue: {
            from: jest.fn(),
          },
        },
        {
          provide: PIIPatternService,
          useValue: mockPIIPatternService,
        },
      ],
    }).compile();

    // Suppress logger output in tests
    module.useLogger(false);

    service = module.get<PIIService>(PIIService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkPolicy - Local Provider Handling', () => {
    it('should skip PII processing for Ollama provider (lowercase)', async () => {
      const prompt = 'Contact me at john@example.com';
      const options = { providerName: 'ollama' };

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.piiDetected).toBe(false);
      expect(result.metadata.showstopperDetected).toBe(false);
      expect(result.metadata.processingFlow).toBe('allowed-local');
      expect(result.metadata.policyDecision.allowed).toBe(true);
      expect(result.metadata.policyDecision.blocked).toBe(false);
      expect(result.originalPrompt).toBe(prompt);
      expect(mockPIIPatternService.detectPII).not.toHaveBeenCalled();
    });

    it('should skip PII processing for Ollama provider (uppercase)', async () => {
      const prompt = 'SSN: 123-45-6789';
      const options = { provider: 'OLLAMA' };

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.piiDetected).toBe(false);
      expect(result.metadata.processingFlow).toBe('allowed-local');
      expect(mockPIIPatternService.detectPII).not.toHaveBeenCalled();
    });

    it('should skip PII processing for Ollama in providerName field', async () => {
      const prompt = 'Credit card: 4111111111111111';
      const options = { providerName: 'Ollama' };

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.processingFlow).toBe('allowed-local');
      expect(mockPIIPatternService.detectPII).not.toHaveBeenCalled();
    });
  });

  describe('checkPolicy - Showstopper Detection (CRITICAL SECURITY)', () => {
    it('should immediately block when showstopper PII detected (SSN)', async () => {
      const prompt = 'My SSN is 123-45-6789';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            confidence: 0.95,
            startIndex: 10,
            endIndex: 21,
            patternName: 'ssn-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      // Critical assertions for security
      expect(result.metadata.showstopperDetected).toBe(true);
      expect(result.metadata.policyDecision.blocked).toBe(true);
      expect(result.metadata.policyDecision.allowed).toBe(false);
      expect(result.metadata.processingFlow).toBe('showstopper-blocked');
      expect(result.metadata.userMessage.isBlocked).toBe(true);
      expect(result.metadata.userMessage.summary).toContain('blocked');

      // Ensure violations are logged
      expect(result.metadata.policyDecision.violations).toContain(
        'Showstopper PII detected: ssn',
      );

      // Ensure no pseudonym instructions created (blocked requests don't need them)
      expect(result.metadata.pseudonymInstructions).toBeUndefined();
    });

    it('should block when multiple showstopper types detected', async () => {
      const prompt = 'SSN: 123-45-6789, Credit Card: 4111111111111111';
      const options = { provider: 'anthropic' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            confidence: 0.95,
            startIndex: 5,
            endIndex: 16,
            patternName: 'ssn-pattern',
          },
          {
            value: '4111111111111111',
            dataType: 'credit_card',
            severity: 'showstopper',
            confidence: 0.9,
            startIndex: 32,
            endIndex: 48,
            patternName: 'credit-card-pattern',
          },
        ],
        processingTime: 15,
        patternsChecked: 2,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.showstopperDetected).toBe(true);
      expect(result.metadata.policyDecision.blocked).toBe(true);
      expect(result.metadata.processingFlow).toBe('showstopper-blocked');

      // Should list all showstopper types
      expect(result.metadata.policyDecision.showstopperTypes).toContain('ssn');
      expect(result.metadata.policyDecision.showstopperTypes).toContain(
        'credit_card',
      );

      // Ensure detection results include all matches
      expect(result.metadata.detectionResults.totalMatches).toBe(2);
      expect(result.metadata.detectionResults.showstopperMatches).toHaveLength(
        2,
      );
    });

    it('should not leak PII in user messages when blocked', async () => {
      const prompt = 'Here is my SSN: 987-65-4321';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '987-65-4321',
            dataType: 'ssn',
            severity: 'showstopper',
            confidence: 0.98,
            startIndex: 16,
            endIndex: 27,
            patternName: 'ssn-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      // Ensure user message doesn't contain actual PII value
      const userMessageStr = JSON.stringify(result.metadata.userMessage);
      expect(userMessageStr).not.toContain('987-65-4321');

      // But should inform about the type
      expect(result.metadata.userMessage.summary).toContain('sensitive');
      expect(result.metadata.userMessage.isBlocked).toBe(true);
    });

    it('should fail-open on detection error in development mode (SECURITY)', async () => {
      const prompt = 'Some potentially sensitive text';
      const options = { providerName: 'openai' };

      // Ensure we're in development mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Simulate detection error
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('Detection service unavailable'),
      );

      const result = await service.checkPolicy(prompt, options);

      // Should allow on error in development (fail-open for debugging)
      expect(result.metadata.policyDecision.allowed).toBe(true);
      expect(result.metadata.policyDecision.violations).toContain(
        'PII policy check failed (dev mode - fail-open)',
      );
      expect(result.metadata.processingFlow).toBe('allowed-local');

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });

    it('should fail-closed on detection error in production mode (CRITICAL SECURITY)', async () => {
      const prompt = 'Some potentially sensitive text';
      const options = { providerName: 'openai' };

      // Set production mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Simulate detection error
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('Detection service unavailable'),
      );

      // Should throw ServiceUnavailableException in production
      await expect(service.checkPolicy(prompt, options)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });

    it('should fail-open on detection error in test mode (SECURITY)', async () => {
      const prompt = 'Some potentially sensitive text';
      const options = { providerName: 'openai' };

      // Ensure we're in test mode (not production)
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      // Simulate detection error
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('Detection service unavailable'),
      );

      const result = await service.checkPolicy(prompt, options);

      // Should allow on error in test mode (fail-open for debugging)
      expect(result.metadata.policyDecision.allowed).toBe(true);

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('checkPolicy - External Provider Handling', () => {
    it('should create pseudonym instructions for external provider with non-showstopper PII', async () => {
      const prompt = 'Contact me at john@example.com';
      const options = { providerName: 'openai', conversationId: 'conv-123' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'john@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 14,
            endIndex: 31,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.piiDetected).toBe(true);
      expect(result.metadata.showstopperDetected).toBe(false);
      expect(result.metadata.policyDecision.allowed).toBe(true);
      expect(result.metadata.policyDecision.blocked).toBe(false);
      expect(result.metadata.processingFlow).toBe('pseudonymized');

      // Should create pseudonym instructions
      expect(result.metadata.pseudonymInstructions).toBeDefined();
      expect(result.metadata.pseudonymInstructions?.context).toBe(
        'llm-boundary',
      );
      expect(result.metadata.pseudonymInstructions?.requestId).toBe('conv-123');
    });

    it('should handle external provider with no PII detected', async () => {
      const prompt = 'What is the weather today?';
      const options = { providerName: 'anthropic' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.piiDetected).toBe(false);
      expect(result.metadata.showstopperDetected).toBe(false);
      expect(result.metadata.policyDecision.allowed).toBe(true);
      expect(result.metadata.detectionResults.totalMatches).toBe(0);
    });

    it('should detect multiple non-showstopper PII types', async () => {
      const prompt = 'Call me at 555-1234 or email test@example.com';
      const options = { provider: 'google' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '555-1234',
            dataType: 'phone',
            severity: 'flagger',
            confidence: 0.85,
            startIndex: 11,
            endIndex: 19,
            patternName: 'phone-pattern',
          },
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 29,
            endIndex: 45,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 12,
        patternsChecked: 2,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.piiDetected).toBe(true);
      expect(result.metadata.detectionResults.totalMatches).toBe(2);
      expect(result.metadata.detectionResults.dataTypesSummary).toHaveProperty(
        'phone',
      );
      expect(result.metadata.detectionResults.dataTypesSummary).toHaveProperty(
        'email',
      );
    });
  });

  describe('checkPolicy - Data Type Summary', () => {
    it('should build correct data type summary', async () => {
      const prompt = 'Email: a@b.com, b@c.com, c@d.com';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'a@b.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 7,
            endIndex: 14,
            patternName: 'email-pattern',
          },
          {
            value: 'b@c.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 16,
            endIndex: 23,
            patternName: 'email-pattern',
          },
          {
            value: 'c@d.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 25,
            endIndex: 32,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      const emailSummary =
        result.metadata.detectionResults.dataTypesSummary.email;
      expect(emailSummary).toBeDefined();
      expect(emailSummary?.count).toBe(3);
      expect(emailSummary?.severity).toBe('info');
      expect(emailSummary?.examples.length).toBeLessThanOrEqual(3);
    });

    it('should build severity breakdown correctly', async () => {
      const prompt = 'Email: test@example.com';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 7,
            endIndex: 23,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.detectionResults.severityBreakdown).toEqual({
        showstopper: 0,
        warning: 0,
        info: 1,
      });
    });
  });

  describe('checkPolicy - User Messages', () => {
    it('should generate appropriate showstopper message', async () => {
      const prompt = 'SSN: 123-45-6789';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            confidence: 0.95,
            startIndex: 5,
            endIndex: 16,
            patternName: 'ssn-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.userMessage.summary).toContain('blocked');
      expect(result.metadata.userMessage.isBlocked).toBe(true);
      expect(result.metadata.userMessage.actionsTaken).toContain(
        'Request immediately blocked',
      );
      expect(result.metadata.userMessage.blockingDetails).toBeDefined();
      expect(
        result.metadata.userMessage.blockingDetails?.showstopperTypes,
      ).toContain('ssn');
    });

    it('should generate appropriate local provider message with PII', async () => {
      const prompt = 'Email: test@example.com';
      const options = { providerName: 'ollama' };

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.userMessage.summary).toContain('Local processing');
      expect(result.metadata.userMessage.isBlocked).toBe(false);
      expect(result.metadata.userMessage.actionsTaken).toContain(
        'No PII processing required',
      );
    });

    it('should generate appropriate external provider message with no PII', async () => {
      const prompt = 'What is 2+2?';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.userMessage.summary).toContain(
        'No personal information detected',
      );
      expect(result.metadata.userMessage.isBlocked).toBe(false);
    });
  });

  describe('checkPolicy - Processing Flow Tracking', () => {
    it('should track processing steps for showstopper flow', async () => {
      const prompt = 'SSN: 123-45-6789';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            confidence: 0.95,
            startIndex: 5,
            endIndex: 16,
            patternName: 'ssn-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.processingSteps).toContain('pii-detection');
      expect(result.metadata.processingSteps).toContain('showstopper-check');
      expect(result.metadata.processingSteps).toContain('request-blocked');
    });

    it('should track processing steps for external provider flow', async () => {
      const prompt = 'Email: test@example.com';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 7,
            endIndex: 23,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.processingSteps).toContain('pii-detection');
      expect(result.metadata.processingSteps).toContain(
        'external-provider-check',
      );
      expect(result.metadata.processingSteps).toContain(
        'pseudonym-instructions-created',
      );
    });

    it('should include timestamps in metadata', async () => {
      const prompt = 'Test prompt';
      const options = { providerName: 'ollama' };

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.timestamps).toBeDefined();
      expect(result.metadata.timestamps.detectionStart).toBeDefined();
      expect(typeof result.metadata.timestamps.detectionStart).toBe('number');
    });
  });

  describe('checkPolicy - Edge Cases', () => {
    it('should handle empty prompt', async () => {
      const prompt = '';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 1,
        patternsChecked: 0,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.piiDetected).toBe(false);
      expect(result.originalPrompt).toBe('');
    });

    it('should handle empty options', async () => {
      const prompt = 'Test prompt';

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const result = await service.checkPolicy(prompt);

      expect(result.metadata).toBeDefined();
      expect(mockPIIPatternService.detectPII).toHaveBeenCalled();
    });

    it('should handle null/undefined provider name', async () => {
      const prompt = 'Test prompt';
      const options = { providerName: undefined as unknown as string };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const _result = await service.checkPolicy(prompt, options);

      // Should process as external provider (not local)
      expect(mockPIIPatternService.detectPII).toHaveBeenCalled();
    });

    it('should handle very long prompts', async () => {
      const prompt = 'a'.repeat(10000);
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 100,
        patternsChecked: 0,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.originalPrompt).toBe(prompt);
      expect(mockPIIPatternService.detectPII).toHaveBeenCalledWith(prompt, {
        minConfidence: 0.8,
        maxMatches: 100,
      });
    });
  });

  describe('checkPolicy - Reasoning Path', () => {
    it('should provide clear reasoning path for blocking decision', async () => {
      const prompt = 'SSN: 123-45-6789';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            confidence: 0.95,
            startIndex: 5,
            endIndex: 16,
            patternName: 'ssn-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.policyDecision.reasoningPath).toContain(
        'PII Detection: COMPLETED',
      );
      expect(result.metadata.policyDecision.reasoningPath).toContain(
        'Showstopper PII found: ssn',
      );
      expect(result.metadata.policyDecision.reasoningPath).toContain(
        'BLOCKING REQUEST - No further processing',
      );
    });

    it('should provide clear reasoning path for allow decision', async () => {
      const prompt = 'Email: test@example.com';
      const options = { providerName: 'openai' };

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 7,
            endIndex: 23,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.policyDecision.reasoningPath).toContain(
        'PII Detection: COMPLETED',
      );
      expect(result.metadata.policyDecision.reasoningPath).toContain(
        'External provider - creating pseudonym instructions',
      );
    });

    it('should provide clear reasoning path for local provider', async () => {
      const prompt = 'Test prompt';
      const options = { providerName: 'ollama' };

      const result = await service.checkPolicy(prompt, options);

      expect(result.metadata.policyDecision.reasoningPath).toContain(
        'Local provider (Ollama) - no PII processing needed',
      );
    });
  });
});
