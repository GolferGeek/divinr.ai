import { Test, TestingModule } from '@nestjs/testing';
import { PatternRedactionService } from './pattern-redaction.service';
import { PIIPatternService } from '../pii-pattern.service';
import { DATABASE_SERVICE } from '@/database';

describe('PatternRedactionService', () => {
  let service: PatternRedactionService;
  let mockPIIPatternService: jest.Mocked<PIIPatternService>;
  let mockSupabaseClient: any;

  beforeEach(async () => {
    mockPIIPatternService = {
      detectPII: jest.fn(),
    } as unknown as jest.Mocked<PIIPatternService>;

    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatternRedactionService,
        {
          provide: PIIPatternService,
          useValue: mockPIIPatternService,
        },
        {
          provide: DATABASE_SERVICE,
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    // Suppress logger output in tests
    module.useLogger(false);

    service = module.get<PatternRedactionService>(PatternRedactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('redactPatterns', () => {
    beforeEach(() => {
      // Mock default replacement map
      mockSupabaseClient.eq.mockReturnThis();
      mockSupabaseClient.from.mockReturnThis();
      mockSupabaseClient.select.mockReturnValue({
        data: [
          { data_type: 'email', replacement: '[EMAIL_REDACTED]' },
          { data_type: 'phone', replacement: '[PHONE_REDACTED]' },
          { data_type: 'ssn', replacement: '[SSN_REDACTED]' },
        ],
        error: null,
      });
    });

    it('should redact email addresses from text', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 14,
            endIndex: 30,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const text = 'Contact me at test@example.com for more info';
      const result = await service.redactPatterns(text);

      expect(result.originalText).toBe(text);
      expect(result.redactedText).toBe(
        'Contact me at [EMAIL_REDACTED] for more info',
      );
      expect(result.redactionCount).toBe(1);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]?.originalValue).toBe('test@example.com');
      expect(result.mappings[0]?.redactedValue).toBe('[EMAIL_REDACTED]');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should redact multiple PII types', async () => {
      // Text: 'Email me at test@example.com or call 555-1234'
      // Positions: Email(0-4) me(6-7) at(9-10) test@example.com(12-27) or(29-30) call(32-35) 555-1234(37-44)
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 12,
            endIndex: 28,
            patternName: 'email-pattern',
          },
          {
            value: '555-1234',
            dataType: 'phone',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 37,
            endIndex: 45,
            patternName: 'phone-pattern',
          },
        ],
        processingTime: 15,
        patternsChecked: 2,
      });

      const text = 'Email me at test@example.com or call 555-1234';
      const result = await service.redactPatterns(text);

      expect(result.redactedText).toBe(
        'Email me at [EMAIL_REDACTED] or call [PHONE_REDACTED]',
      );
      expect(result.redactionCount).toBe(2);
      expect(result.mappings).toHaveLength(2);
    });

    it('should handle multiple instances of same type with unique placeholders', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'first@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 0,
            endIndex: 17,
            patternName: 'email-pattern',
          },
          {
            value: 'second@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 22,
            endIndex: 40,
            patternName: 'email-pattern',
          },
          {
            value: 'third@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 45,
            endIndex: 62,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 12,
        patternsChecked: 1,
      });

      const text =
        'first@example.com and second@example.com and third@example.com';
      const result = await service.redactPatterns(text);

      // Service processes from end to start, so numbering is reversed
      // third gets _1 (first processed), second gets _2, first gets _3
      // After mappings.reverse(), order is: first, second, third
      expect(result.redactedText).toBe(
        '[EMAIL_REDACTED]_3 and [EMAIL_REDACTED]_2 and [EMAIL_REDACTED]',
      );
      expect(result.mappings).toHaveLength(3);
      // After reverse, mappings are in original text order
      expect(result.mappings[0]?.redactedValue).toBe('[EMAIL_REDACTED]_3');
      expect(result.mappings[1]?.redactedValue).toBe('[EMAIL_REDACTED]_2');
      expect(result.mappings[2]?.redactedValue).toBe('[EMAIL_REDACTED]');
    });

    it('should exclude showstoppers when option is set', async () => {
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
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 24,
            endIndex: 40,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 15,
        patternsChecked: 2,
      });

      const text = 'SSN: 123-45-6789 Email: test@example.com';
      const result = await service.redactPatterns(text, {
        excludeShowstoppers: true,
      });

      // Should only redact email, not SSN
      expect(result.redactedText).toBe(
        'SSN: 123-45-6789 Email: [EMAIL_REDACTED]',
      );
      expect(result.redactionCount).toBe(1);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]?.dataType).toBe('email');
    });

    it('should include showstoppers by default', async () => {
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

      const text = 'SSN: 123-45-6789';
      const result = await service.redactPatterns(text);

      expect(result.redactedText).toBe('SSN: [SSN_REDACTED]');
      expect(result.redactionCount).toBe(1);
    });

    it('should handle text with no PII', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const text = 'This is clean text';
      const result = await service.redactPatterns(text);

      expect(result.redactedText).toBe(text);
      expect(result.redactionCount).toBe(0);
      expect(result.mappings).toHaveLength(0);
    });

    it('should handle empty text', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 1,
        patternsChecked: 0,
      });

      const result = await service.redactPatterns('');

      expect(result.redactedText).toBe('');
      expect(result.redactionCount).toBe(0);
    });

    it('should use default replacement for unknown data types', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'unknown-value',
            dataType: 'custom',
            severity: 'flagger',
            confidence: 0.8,
            startIndex: 0,
            endIndex: 13,
            patternName: 'custom-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const text = 'unknown-value here';
      const result = await service.redactPatterns(text);

      expect(result.redactedText).toBe('[CUSTOM_REDACTED] here');
    });

    it('should respect minConfidence option', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const text = 'Some text';
      await service.redactPatterns(text, { minConfidence: 0.9 });

      expect(mockPIIPatternService.detectPII).toHaveBeenCalledWith(text, {
        minConfidence: 0.9,
        maxMatches: 100,
      });
    });

    it('should respect maxMatches option', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [],
        processingTime: 5,
        patternsChecked: 0,
      });

      const text = 'Some text';
      await service.redactPatterns(text, { maxMatches: 50 });

      expect(mockPIIPatternService.detectPII).toHaveBeenCalledWith(text, {
        minConfidence: 0.8,
        maxMatches: 50,
      });
    });

    it('should handle database error gracefully when loading replacement map', async () => {
      mockSupabaseClient.select.mockReturnValue({
        data: null,
        error: { message: 'Database error' },
      });

      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 0,
            endIndex: 16,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const text = 'test@example.com';
      const result = await service.redactPatterns(text);

      // Should use default replacement format
      expect(result.redactedText).toBe('[EMAIL_REDACTED]');
    });
  });

  describe('reverseRedactions', () => {
    it('should reverse redactions back to original values', async () => {
      const mappings = [
        {
          originalValue: 'test@example.com',
          redactedValue: '[EMAIL_REDACTED]',
          dataType: 'email',
          startIndex: 11,
          endIndex: 27,
          patternName: 'email-pattern',
        },
        {
          originalValue: '555-1234',
          redactedValue: '[PHONE_REDACTED]',
          dataType: 'phone',
          startIndex: 39,
          endIndex: 47,
          patternName: 'phone-pattern',
        },
      ];

      const text = 'Email me at [EMAIL_REDACTED] or call [PHONE_REDACTED]';
      const result = await service.reverseRedactions(text, mappings);

      expect(result.originalText).toBe(
        'Email me at test@example.com or call 555-1234',
      );
      expect(result.reversalCount).toBe(2);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple instances with unique placeholders', async () => {
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
        {
          originalValue: 'third@example.com',
          redactedValue: '[EMAIL_REDACTED]_3',
          dataType: 'email',
          startIndex: 45,
          endIndex: 62,
          patternName: 'email-pattern',
        },
      ];

      const text =
        '[EMAIL_REDACTED] and [EMAIL_REDACTED]_2 and [EMAIL_REDACTED]_3';
      const result = await service.reverseRedactions(text, mappings);

      expect(result.originalText).toBe(
        'first@example.com and second@example.com and third@example.com',
      );
      expect(result.reversalCount).toBe(3);
    });

    it('should handle text with no matches', async () => {
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

      const text = 'No redacted content here';
      const result = await service.reverseRedactions(text, mappings);

      expect(result.originalText).toBe(text);
      expect(result.reversalCount).toBe(0);
    });

    it('should handle empty mappings', async () => {
      const text = 'Some text';
      const result = await service.reverseRedactions(text, []);

      expect(result.originalText).toBe(text);
      expect(result.reversalCount).toBe(0);
    });

    it('should handle empty text', async () => {
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

      const result = await service.reverseRedactions('', mappings);

      expect(result.originalText).toBe('');
      expect(result.reversalCount).toBe(0);
    });

    it('should escape regex special characters in redacted values', async () => {
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

      const text = 'Contact: [EMAIL_REDACTED]';
      const result = await service.reverseRedactions(text, mappings);

      expect(result.originalText).toBe('Contact: test@example.com');
    });

    it('should process mappings in order of longest redacted value first', async () => {
      const mappings = [
        {
          originalValue: 'short',
          redactedValue: '[A]',
          dataType: 'custom',
          startIndex: 0,
          endIndex: 5,
          patternName: 'custom-pattern',
        },
        {
          originalValue: 'very-long-value',
          redactedValue: '[VERY_LONG_REDACTED]',
          dataType: 'custom',
          startIndex: 10,
          endIndex: 25,
          patternName: 'custom-pattern',
        },
      ];

      const text = '[A] and [VERY_LONG_REDACTED]';
      const result = await service.reverseRedactions(text, mappings);

      expect(result.originalText).toBe('short and very-long-value');
    });
  });

  describe('Full Workflow (Redact then Reverse)', () => {
    beforeEach(() => {
      mockSupabaseClient.eq.mockReturnThis();
      mockSupabaseClient.from.mockReturnThis();
      mockSupabaseClient.select.mockReturnValue({
        data: [
          { data_type: 'email', replacement: '[EMAIL_REDACTED]' },
          { data_type: 'phone', replacement: '[PHONE_REDACTED]' },
        ],
        error: null,
      });
    });

    it('should restore original text after redaction and reversal', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'test@example.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.95,
            startIndex: 14,
            endIndex: 30,
            patternName: 'email-pattern',
          },
          {
            value: '555-1234',
            dataType: 'phone',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 39,
            endIndex: 47,
            patternName: 'phone-pattern',
          },
        ],
        processingTime: 15,
        patternsChecked: 2,
      });

      const originalText = 'Contact me at test@example.com or call 555-1234';

      // Redact
      const redactResult = await service.redactPatterns(originalText);

      expect(redactResult.redactedText).toBe(
        'Contact me at [EMAIL_REDACTED] or call [PHONE_REDACTED]',
      );

      // Reverse
      const reverseResult = await service.reverseRedactions(
        redactResult.redactedText,
        redactResult.mappings,
      );

      expect(reverseResult.originalText).toBe(originalText);
    });

    it('should handle multiple instances correctly in full workflow', async () => {
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: [
          {
            value: 'a@b.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 0,
            endIndex: 7,
            patternName: 'email-pattern',
          },
          {
            value: 'c@d.com',
            dataType: 'email',
            severity: 'flagger',
            confidence: 0.9,
            startIndex: 12,
            endIndex: 19,
            patternName: 'email-pattern',
          },
        ],
        processingTime: 10,
        patternsChecked: 1,
      });

      const originalText = 'a@b.com and c@d.com';

      const redactResult = await service.redactPatterns(originalText);
      const reverseResult = await service.reverseRedactions(
        redactResult.redactedText,
        redactResult.mappings,
      );

      expect(reverseResult.originalText).toBe(originalText);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      mockSupabaseClient.eq.mockReturnThis();
      mockSupabaseClient.from.mockReturnThis();
      mockSupabaseClient.select.mockReturnValue({
        data: [],
        error: null,
      });
    });

    it('should handle detection service errors', async () => {
      mockPIIPatternService.detectPII.mockRejectedValue(
        new Error('Detection failed'),
      );

      await expect(service.redactPatterns('test')).rejects.toThrow(
        'Detection failed',
      );
    });

    it('should handle reversal errors', async () => {
      const mappings = [
        {
          originalValue: 'test',
          redactedValue: '[INVALID',
          dataType: 'custom',
          startIndex: 0,
          endIndex: 4,
          patternName: 'custom-pattern',
        },
      ];

      // Should not throw, but handle gracefully
      const result = await service.reverseRedactions('text', mappings);
      expect(result).toBeDefined();
    });

    it('should handle very long text', async () => {
      const longText = 'test@example.com '.repeat(1000);
      mockPIIPatternService.detectPII.mockResolvedValue({
        matches: Array.from({ length: 1000 }, (_, i) => ({
          value: 'test@example.com',
          dataType: 'email',
          severity: 'flagger',
          confidence: 0.9,
          startIndex: i * 17,
          endIndex: i * 17 + 16,
          patternName: 'email-pattern',
        })),
        processingTime: 100,
        patternsChecked: 1,
      });

      const result = await service.redactPatterns(longText);
      expect(result.redactionCount).toBe(1000);
    });
  });
});
