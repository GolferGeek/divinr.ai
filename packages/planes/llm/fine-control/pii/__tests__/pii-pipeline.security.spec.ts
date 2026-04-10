/**
 * PII Pipeline Security Tests - Comprehensive Edge Cases
 *
 * SECURITY CRITICAL: These tests cover edge cases not addressed in the
 * co-located spec files. They focus on attack vectors, boundary conditions,
 * and security invariants that must hold under adversarial inputs.
 *
 * Coverage Areas:
 * - Adversarial PII inputs (partial matches, embedded PII, Unicode)
 * - Provider bypass attempts
 * - Mixed showstopper + non-showstopper combinations
 * - Metadata integrity (no PII leakage in metadata)
 * - Pattern redaction regex injection resistance
 * - Dictionary pseudonymizer scoping and priority
 * - Roundtrip fidelity (redact -> LLM response -> reverse)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { PIIService } from '../pii.service';
import { PatternRedactionService } from '../pattern-redaction.service';
import { DictionaryPseudonymizerService } from '../dictionary-pseudonymizer.service';
import { DATABASE_SERVICE } from '@/database';
import {
  PIIPatternService,
  PIIDataType,
  PIIMatch as RawPIIMatch,
  PIIDetectionResult,
} from '../../pii-pattern.service';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const buildPIIMatch = (overrides: {
  value: string;
  dataType: PIIDataType;
  severity: 'showstopper' | 'flagger';
  confidence?: number;
  startIndex?: number;
  endIndex?: number;
  patternName?: string;
}): RawPIIMatch => ({
  confidence: 0.9,
  startIndex: 0,
  endIndex: overrides.value.length,
  patternName: `${overrides.dataType}-pattern`,
  ...overrides,
});

const buildDetectionResult = (matches: RawPIIMatch[]): PIIDetectionResult => ({
  matches,
  processingTime: 10,
  patternsChecked: matches.length,
});

// ─── PIIService — Adversarial Inputs ─────────────────────────────────────────

describe('PIIService — Adversarial and Edge-Case Inputs', () => {
  let service: PIIService;
  let mockPIIPatternService: jest.Mocked<PIIPatternService>;

  beforeEach(async () => {
    mockPIIPatternService = {
      detectPII: jest.fn(),
    } as unknown as jest.Mocked<PIIPatternService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PIIService,
        { provide: DATABASE_SERVICE, useValue: { from: jest.fn() } },
        { provide: PIIPatternService, useValue: mockPIIPatternService },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<PIIService>(PIIService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Provider name bypass attempts ────────────────────────────────────────────

  describe('Provider Identification — Bypass Resistance', () => {
    it('should not bypass PII check for provider "ollama2"', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([]),
      );

      const result = await service.checkPolicy('test', {
        providerName: 'ollama2',
      });

      // "ollama2" is not "ollama" — must go through external flow
      expect(mockPIIPatternService.detectPII).toHaveBeenCalled();
      expect(result.metadata.policyDecision.appliedFor).toBe('external');
    });

    it('should not bypass PII check for provider "OLLAMA_local"', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([]),
      );

      await service.checkPolicy('test', { providerName: 'OLLAMA_local' });

      expect(mockPIIPatternService.detectPII).toHaveBeenCalled();
    });

    it('should not bypass PII check for provider ""', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([]),
      );

      await service.checkPolicy('test', { providerName: '' });

      expect(mockPIIPatternService.detectPII).toHaveBeenCalled();
    });

    it('should recognise ollama via "provider" field as well as "providerName"', async () => {
      const result = await service.checkPolicy('test', { provider: 'ollama' });

      // Local path: no detection needed
      expect(mockPIIPatternService.detectPII).not.toHaveBeenCalled();
      expect(result.metadata.processingFlow).toBe('allowed-local');
    });

    it('should treat null providerName as external provider', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([]),
      );

      await service.checkPolicy('test', {
        providerName: null as unknown as string,
      });

      expect(mockPIIPatternService.detectPII).toHaveBeenCalled();
    });
  });

  // ── Showstopper invariants ────────────────────────────────────────────────────

  describe('Showstopper Invariants — Must Never Be Bypassed', () => {
    it('should block when showstopper is mixed with non-showstopper PII', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 0,
            endIndex: 16,
          }),
          buildPIIMatch({
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            startIndex: 20,
            endIndex: 31,
          }),
          buildPIIMatch({
            value: '555-0100',
            dataType: 'phone',
            severity: 'flagger',
            startIndex: 35,
            endIndex: 43,
          }),
        ]),
      );

      const result = await service.checkPolicy(
        'user@example.com SSN 123-45-6789 555-0100',
        { providerName: 'openai' },
      );

      // Showstopper dominates — entire request blocked
      expect(result.metadata.showstopperDetected).toBe(true);
      expect(result.metadata.policyDecision.blocked).toBe(true);
      expect(result.metadata.processingFlow).toBe('showstopper-blocked');

      // All three matches should appear in flaggedMatches for audit trail
      expect(result.metadata.detectionResults.flaggedMatches).toHaveLength(3);

      // Only SSN in showstopperMatches
      expect(result.metadata.detectionResults.showstopperMatches).toHaveLength(
        1,
      );
      expect(
        result.metadata.detectionResults.showstopperMatches![0]!.dataType,
      ).toBe('ssn');
    });

    it('should block credit card even when confidence is exactly 0.8 (minConfidence boundary)', async () => {
      // The service calls detectPII with minConfidence: 0.8
      // A match at exactly 0.8 confidence that is a showstopper must block
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: '4111111111111111',
            dataType: 'credit_card',
            severity: 'showstopper',
            confidence: 0.8,
          }),
        ]),
      );

      const result = await service.checkPolicy('Card: 4111111111111111', {
        providerName: 'anthropic',
      });

      expect(result.metadata.showstopperDetected).toBe(true);
      expect(result.metadata.policyDecision.blocked).toBe(true);
    });

    it('should not create pseudonymInstructions for blocked requests', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: '987-65-4321',
            dataType: 'ssn',
            severity: 'showstopper',
          }),
        ]),
      );

      const result = await service.checkPolicy('SSN: 987-65-4321', {
        providerName: 'openai',
      });

      // SECURITY: Blocked requests must NOT have pseudonymInstructions
      // (there is nothing to pseudonymize when the request is blocked)
      expect(result.metadata.pseudonymInstructions).toBeUndefined();
    });

    it('should not include pseudonymResults for showstopper (comment guarantee)', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: '111-22-3333',
            dataType: 'ssn',
            severity: 'showstopper',
          }),
        ]),
      );

      const result = await service.checkPolicy('SSN: 111-22-3333', {
        providerName: 'openai',
      });

      // The code comments guarantee this — assert it explicitly
      expect(
        (result.metadata as unknown as Record<string, unknown>)
          .pseudonymResults,
      ).toBeUndefined();
    });

    it('should block for multiple credit cards with distinct deduplication', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: '4111111111111111',
            dataType: 'credit_card',
            severity: 'showstopper',
            startIndex: 0,
            endIndex: 16,
          }),
          buildPIIMatch({
            value: '5500005555555559',
            dataType: 'credit_card',
            severity: 'showstopper',
            startIndex: 20,
            endIndex: 36,
          }),
        ]),
      );

      const result = await service.checkPolicy(
        '4111111111111111 and 5500005555555559',
        { providerName: 'openai' },
      );

      // De-duplicated showstopper types — only one "credit_card" entry
      expect(result.metadata.policyDecision.showstopperTypes).toEqual([
        'credit_card',
      ]);
      expect(result.metadata.detectionResults.totalMatches).toBe(2);
    });
  });

  // ── User message PII leak prevention ─────────────────────────────────────────

  describe('User Message — PII Leakage Prevention', () => {
    const sensitiveValues: Array<{ value: string; type: PIIDataType }> = [
      { value: '123-45-6789', type: 'ssn' },
      { value: '4111111111111111', type: 'credit_card' },
      { value: '5500005555555559', type: 'credit_card' },
    ];

    sensitiveValues.forEach(({ value, type }) => {
      it(`should not include raw ${type} value "${value.substring(0, 4)}..." in userMessage`, async () => {
        mockPIIPatternService.detectPII.mockResolvedValue(
          buildDetectionResult([
            buildPIIMatch({ value, dataType: type, severity: 'showstopper' }),
          ]),
        );

        const result = await service.checkPolicy(`Sensitive: ${value}`, {
          providerName: 'openai',
        });

        const userMessageJson = JSON.stringify(result.metadata.userMessage);
        expect(userMessageJson).not.toContain(value);
      });
    });

    it('should include human-readable type name in showstopper message', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
          }),
        ]),
      );

      const result = await service.checkPolicy('SSN: 123-45-6789', {
        providerName: 'openai',
      });

      // Should use human-readable label, not raw type key
      const details = result.metadata.userMessage.details.join(' ');
      expect(details).toContain('Social Security Number');
    });

    it('should include human-readable type for credit_card showstopper', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: '4111111111111111',
            dataType: 'credit_card',
            severity: 'showstopper',
          }),
        ]),
      );

      const result = await service.checkPolicy('Card: 4111111111111111', {
        providerName: 'openai',
      });

      const details = result.metadata.userMessage.details.join(' ');
      expect(details).toContain('Credit Card Number');
    });

    it('should truncate examples to 3 chars for data type summary', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'verylongemail@example.com',
            dataType: 'email',
            severity: 'flagger',
          }),
        ]),
      );

      const result = await service.checkPolicy(
        'email: verylongemail@example.com',
        {
          providerName: 'openai',
        },
      );

      const emailSummary =
        result.metadata.detectionResults.dataTypesSummary['email'];
      expect(emailSummary).toBeDefined();
      // Examples should be truncated to 3 chars + "..."
      emailSummary!.examples.forEach((example) => {
        expect(example.length).toBeLessThanOrEqual(6); // "abc..." = 6 chars
      });
    });
  });

  // ── Request ID generation ─────────────────────────────────────────────────────

  describe('External Provider — Request ID Fallback', () => {
    it('should generate unique requestId when neither conversationId nor requestId provided', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
          }),
        ]),
      );

      const result1 = await service.checkPolicy('user@example.com', {
        providerName: 'openai',
      });

      // Re-mock for second call
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
          }),
        ]),
      );

      const result2 = await service.checkPolicy('user@example.com', {
        providerName: 'openai',
      });

      const id1 = result1.metadata.pseudonymInstructions?.requestId;
      const id2 = result2.metadata.pseudonymInstructions?.requestId;

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      // Each call without a conversationId should produce a unique requestId
      expect(id1).not.toBe(id2);
    });

    it('should use conversationId as requestId when provided', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
          }),
        ]),
      );

      const result = await service.checkPolicy('user@example.com', {
        providerName: 'openai',
        conversationId: 'conv-abc-123',
      });

      expect(result.metadata.pseudonymInstructions?.requestId).toBe(
        'conv-abc-123',
      );
    });

    it('should use requestId as fallback when conversationId not present', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
          }),
        ]),
      );

      const result = await service.checkPolicy('user@example.com', {
        providerName: 'openai',
        requestId: 'req-xyz-456',
      });

      expect(result.metadata.pseudonymInstructions?.requestId).toBe(
        'req-xyz-456',
      );
    });
  });

  // ── External provider pseudonym instructions ──────────────────────────────────

  describe('External Provider — Pseudonym Instructions', () => {
    it('shouldPseudonymize is false when no showstopper and no target matches', async () => {
      // The service always creates empty pseudonymizerMatches — this is by design.
      // Pseudonymization is disabled for pattern matches; only dictionary handles it.
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
          }),
        ]),
      );

      const result = await service.checkPolicy('Email: user@example.com', {
        providerName: 'openai',
      });

      expect(result.metadata.pseudonymInstructions).toBeDefined();
      expect(result.metadata.pseudonymInstructions!.shouldPseudonymize).toBe(
        false,
      );
      expect(result.metadata.pseudonymInstructions!.targetMatches).toHaveLength(
        0,
      );
      expect(result.metadata.pseudonymInstructions!.context).toBe(
        'llm-boundary',
      );
    });
  });

  // ── Production fail-closed ────────────────────────────────────────────────────

  describe('Production Fail-Closed Behaviour', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      process.env = { ...OLD_ENV };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('should throw ServiceUnavailableException in production on any error', async () => {
      process.env.NODE_ENV = 'production';
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('Redis timeout'),
      );

      await expect(
        service.checkPolicy('sensitive data', { providerName: 'openai' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('error message in production must not reveal internal error details', async () => {
      process.env.NODE_ENV = 'production';
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('Internal Redis connection pool exhausted at 10.0.0.2:6379'),
      );

      try {
        await service.checkPolicy('test', { providerName: 'openai' });
        fail('Expected ServiceUnavailableException');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const message = (err as ServiceUnavailableException).message;
        expect(message).not.toContain('Redis');
        expect(message).not.toContain('10.0.0.2');
        expect(message).not.toContain('6379');
      }
    });

    it('should allow through in test mode on error (fail-open)', async () => {
      process.env.NODE_ENV = 'test';
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('service down'),
      );

      const result = await service.checkPolicy('test', {
        providerName: 'openai',
      });

      expect(result.metadata.policyDecision.allowed).toBe(true);
      expect(result.metadata.policyDecision.violations).toContain(
        'PII policy check failed (dev mode - fail-open)',
      );
    });
  });

  // ── Severity breakdown accuracy ───────────────────────────────────────────────

  describe('Severity Breakdown Accuracy', () => {
    it('should correctly count mixed severities', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@test.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 0,
            endIndex: 13,
          }),
          buildPIIMatch({
            value: 'other@test.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 15,
            endIndex: 29,
          }),
          buildPIIMatch({
            value: '123-45-6789',
            dataType: 'ssn',
            severity: 'showstopper',
            startIndex: 31,
            endIndex: 42,
          }),
        ]),
      );

      const result = await service.checkPolicy(
        'user@test.com other@test.com 123-45-6789',
        { providerName: 'openai' },
      );

      // Showstopper dominates — but breakdown counts all
      expect(
        result.metadata.detectionResults.severityBreakdown.showstopper,
      ).toBe(1);
      expect(result.metadata.detectionResults.severityBreakdown.info).toBe(2);
      expect(result.metadata.detectionResults.severityBreakdown.warning).toBe(
        0,
      );
    });

    it('should cap examples at 3 per data type', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'a@b.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 0,
            endIndex: 7,
          }),
          buildPIIMatch({
            value: 'b@c.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 10,
            endIndex: 17,
          }),
          buildPIIMatch({
            value: 'c@d.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 20,
            endIndex: 27,
          }),
          buildPIIMatch({
            value: 'd@e.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 30,
            endIndex: 37,
          }),
          buildPIIMatch({
            value: 'e@f.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 40,
            endIndex: 47,
          }),
        ]),
      );

      const result = await service.checkPolicy(
        'emails: a@b.com b@c.com c@d.com d@e.com e@f.com',
        { providerName: 'openai' },
      );

      const summary =
        result.metadata.detectionResults.dataTypesSummary['email'];
      expect(summary!.count).toBe(5);
      // Examples must be capped at 3
      expect(summary!.examples).toHaveLength(3);
    });
  });
});

// ─── PatternRedactionService — Security Edge Cases ───────────────────────────

describe('PatternRedactionService — Security Edge Cases', () => {
  let service: PatternRedactionService;
  let mockPIIPatternService: jest.Mocked<PIIPatternService>;
  let mockSupabaseClient: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
  };

  beforeEach(async () => {
    mockPIIPatternService = {
      detectPII: jest.fn(),
    } as unknown as jest.Mocked<PIIPatternService>;

    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnValue({ data: [], error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatternRedactionService,
        { provide: PIIPatternService, useValue: mockPIIPatternService },
        { provide: DATABASE_SERVICE, useValue: mockSupabaseClient },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<PatternRedactionService>(PatternRedactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Regex Injection Resistance', () => {
    it('should safely handle redacted values containing regex special chars', async () => {
      // If escapeRegex is broken, this would cause a regex parse error
      const mappings = [
        {
          originalValue: 'test@example.com',
          redactedValue: '[EMAIL_REDACTED]',
          dataType: 'email',
          startIndex: 0,
          endIndex: 16,
          patternName: 'email-pattern',
        },
      ];

      // Should not throw
      const result = await service.reverseRedactions(
        'Contact: [EMAIL_REDACTED]',
        mappings,
      );
      expect(result.originalText).toBe('Contact: test@example.com');
    });

    it('should safely handle original values containing regex special chars', async () => {
      const mappings = [
        {
          originalValue: 'user+tag@example.com',
          redactedValue: '[EMAIL_REDACTED]',
          dataType: 'email',
          startIndex: 0,
          endIndex: 20,
          patternName: 'email-pattern',
        },
      ];

      const result = await service.reverseRedactions(
        'Email: [EMAIL_REDACTED]',
        mappings,
      );

      expect(result.originalText).toBe('Email: user+tag@example.com');
    });

    it('should safely handle original value with parentheses', async () => {
      const mappings = [
        {
          originalValue: '(555) 123-4567',
          redactedValue: '[PHONE_REDACTED]',
          dataType: 'phone',
          startIndex: 0,
          endIndex: 14,
          patternName: 'phone-pattern',
        },
      ];

      const result = await service.reverseRedactions(
        'Call: [PHONE_REDACTED]',
        mappings,
      );

      expect(result.originalText).toBe('Call: (555) 123-4567');
    });

    it('should not allow regex injection through redacted value with dot', async () => {
      // Redacted value ".+" would match anything if not escaped
      const mappings = [
        {
          originalValue: 'secret',
          redactedValue: '.+',
          dataType: 'custom',
          startIndex: 0,
          endIndex: 6,
          patternName: 'custom-pattern',
        },
      ];

      // Should not perform a global replacement due to unescaped regex
      const result = await service.reverseRedactions('abc .+ def', mappings);

      // Only the literal ".+" should be replaced
      expect(result.originalText).toBe('abc secret def');
    });
  });

  describe('Index-Based Replacement Correctness', () => {
    it('should correctly replace PII at start of text', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 0,
            endIndex: 16,
          }),
        ]),
      );

      mockSupabaseClient.eq.mockReturnValue({
        data: [{ data_type: 'email', replacement: '[EMAIL]' }],
        error: null,
      });

      const result = await service.redactPatterns(
        'user@example.com is the contact',
      );
      expect(result.redactedText.startsWith('[EMAIL]')).toBe(true);
    });

    it('should correctly replace PII at end of text', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([
          buildPIIMatch({
            value: 'user@example.com',
            dataType: 'email',
            severity: 'flagger',
            startIndex: 20,
            endIndex: 36,
          }),
        ]),
      );

      mockSupabaseClient.eq.mockReturnValue({
        data: [{ data_type: 'email', replacement: '[EMAIL]' }],
        error: null,
      });

      const result = await service.redactPatterns(
        'Contact email: user@example.com',
      );
      expect(result.redactedText.endsWith('[EMAIL]')).toBe(true);
    });

    it('should maintain original text for no-match case', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue(
        buildDetectionResult([]),
      );

      const original = 'This text has no PII whatsoever.';
      const result = await service.redactPatterns(original);

      expect(result.redactedText).toBe(original);
      expect(result.redactionCount).toBe(0);
      expect(result.mappings).toHaveLength(0);
    });
  });

  describe('Reversal — Longest-First Ordering', () => {
    it('should process longer placeholders before shorter ones to avoid substring collisions', async () => {
      // [EMAIL_REDACTED]_2 contains [EMAIL_REDACTED] as substring.
      // Processing shorter first would corrupt the longer placeholder.
      const mappings = [
        {
          originalValue: 'first@example.com',
          redactedValue: '[EMAIL_REDACTED]',
          dataType: 'email',
          startIndex: 0,
          endIndex: 17,
          patternName: 'email-pattern',
        },
        {
          originalValue: 'second@example.com',
          redactedValue: '[EMAIL_REDACTED]_2',
          dataType: 'email',
          startIndex: 22,
          endIndex: 40,
          patternName: 'email-pattern',
        },
      ];

      const text = '[EMAIL_REDACTED] and [EMAIL_REDACTED]_2';
      const result = await service.reverseRedactions(text, mappings);

      expect(result.originalText).toBe(
        'first@example.com and second@example.com',
      );
    });
  });
});

// ─── DictionaryPseudonymizerService — Security Edge Cases ────────────────────

describe('DictionaryPseudonymizerService — Security Edge Cases', () => {
  let service: DictionaryPseudonymizerService;
  let mockSupabaseClient: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    not: jest.Mock;
  };

  beforeEach(async () => {
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DictionaryPseudonymizerService,
        { provide: DATABASE_SERVICE, useValue: mockSupabaseClient },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<DictionaryPseudonymizerService>(
      DictionaryPseudonymizerService,
    );
    service.clearCache();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockGlobalQuery = (globalData: unknown[]) => {
    mockSupabaseClient.not = jest
      .fn()
      .mockReturnValueOnce(mockSupabaseClient)
      .mockReturnValue({ data: globalData, error: null });
  };

  describe('Regex Injection Resistance', () => {
    it('should safely handle original_value containing regex metacharacters', async () => {
      mockGlobalQuery([
        {
          original_value: 'user.name+tag@example.com',
          pseudonym: 'EMAIL_1',
          data_type: 'email',
          category: 'contact',
        },
      ]);

      // If escapeRegex is broken, "user.name+tag@example.com" regex would
      // match unintended strings like "username_tag_example_com"
      const result = await service.pseudonymizeText(
        'Contact user.name+tag@example.com directly',
      );

      expect(result.pseudonymizedText).toBe('Contact EMAIL_1 directly');
    });

    it('should safely handle pseudonym containing regex metacharacters', async () => {
      mockGlobalQuery([
        {
          original_value: 'John Doe',
          pseudonym: '[PERSON.1]',
          data_type: 'name',
          category: 'person',
        },
      ]);

      const result = await service.pseudonymizeText('John Doe is here');
      expect(result.pseudonymizedText).toBe('[PERSON.1] is here');

      // Now reverse — if escapeRegex is broken, "[PERSON.1]" as a regex
      // would mean "any char from PERSO, then N.1"
      const reversed = await service.reversePseudonyms(
        '[PERSON.1] is here',
        result.mappings,
      );
      expect(reversed.originalText).toBe('John Doe is here');
    });
  });

  describe('Scoped Dictionary Priority', () => {
    const mockScopedQueries = (
      agentData: unknown[],
      globalData: unknown[],
    ) => {
      mockSupabaseClient.not = jest
        .fn()
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce({ data: agentData, error: null })
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValue({ data: globalData, error: null });
    };

    it('should prefer agent-scoped entry over global when same original_value', async () => {
      mockScopedQueries(
        [
          {
            original_value: 'Acme Corp',
            pseudonym: 'AGENT_COMPANY',
            data_type: 'organization',
            category: 'company',
            organization_slug: null,
            agent_slug: 'my-agent',
          },
        ],
        [
          {
            original_value: 'Acme Corp',
            pseudonym: 'GLOBAL_COMPANY',
            data_type: 'organization',
            category: 'company',
            organization_slug: null,
            agent_slug: null,
          },
        ],
      );

      const result = await service.pseudonymizeText('Acme Corp is the client', {
        agentSlug: 'my-agent',
      });

      // Agent-scoped wins
      expect(result.pseudonymizedText).toBe('AGENT_COMPANY is the client');
    });
  });

  describe('Roundtrip Fidelity', () => {
    it('should produce identical original text after pseudonymize + reverse', async () => {
      const testCases = [
        'John Doe emailed contact@example.com',
        'The CEO of Acme Corp called again.',
        'SSN not detected here, just John Doe.',
      ];

      const dictEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_A',
          data_type: 'name',
          category: 'person',
        },
        {
          original_value: 'Acme Corp',
          pseudonym: 'COMPANY_A',
          data_type: 'organization',
          category: 'company',
        },
        {
          original_value: 'contact@example.com',
          pseudonym: 'EMAIL_A',
          data_type: 'email',
          category: 'contact',
        },
      ];

      // Each iteration clears cache and re-queries DB, so set up enough mocks.
      // Each global query uses 2 .not() calls, so for 3 iterations: 6 .not() calls.
      mockSupabaseClient.not = jest
        .fn()
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce({ data: dictEntries, error: null })
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce({ data: dictEntries, error: null })
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValue({ data: dictEntries, error: null });

      for (const originalText of testCases) {
        const pseudoResult = await service.pseudonymizeText(originalText);
        service.clearCache(); // force re-query on next iteration

        const reverseResult = await service.reversePseudonyms(
          pseudoResult.pseudonymizedText,
          pseudoResult.mappings,
        );

        expect(reverseResult.originalText).toBe(originalText);
      }
    });

    it('should handle case variation in original text after roundtrip', async () => {
      mockGlobalQuery([
        {
          original_value: 'john doe',
          pseudonym: 'PERSON_A',
          data_type: 'name',
          category: 'person',
        },
      ]);

      // Input has title-case: "John Doe" — dictionary key is lowercase: "john doe"
      const result = await service.pseudonymizeText('John Doe visited');
      expect(result.pseudonymizedText).toBe('PERSON_A visited');

      // Reversal uses mappings from the pseudonymization step
      const reversed = await service.reversePseudonyms(
        result.pseudonymizedText,
        result.mappings,
      );

      // Original value stored in mapping is "john doe" (from dictionary)
      expect(reversed.originalText).toBe('john doe visited');
    });
  });

  describe('Empty and Degenerate Inputs', () => {
    it('should handle text with only whitespace', async () => {
      mockGlobalQuery([]);

      const result = await service.pseudonymizeText('   ');
      expect(result.pseudonymizedText).toBe('   ');
      expect(result.mappings).toHaveLength(0);
    });

    it('should handle reversal of text with no pseudonyms', async () => {
      const mappings = [
        {
          originalValue: 'John Doe',
          pseudonym: 'PERSON_A',
          dataType: 'name',
          category: 'person',
        },
      ];

      const result = await service.reversePseudonyms(
        'This text has no pseudonyms.',
        mappings,
      );

      expect(result.originalText).toBe('This text has no pseudonyms.');
      expect(result.reversalCount).toBe(0);
    });

    it('should throw when database returns error on global query', async () => {
      mockSupabaseClient.not = jest
        .fn()
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValue({
          data: null,
          error: { message: 'Connection refused' },
        });

      await expect(service.pseudonymizeText('test data')).rejects.toThrow(
        'Failed to load pseudonym dictionary',
      );
    });
  });
});
