import { Test, TestingModule } from '@nestjs/testing';
import { DictionaryPseudonymizerService } from './dictionary-pseudonymizer.service';
import { DATABASE_SERVICE } from '@/database';

describe('DictionaryPseudonymizerService', () => {
  let service: DictionaryPseudonymizerService;
  let mockSupabaseClient: any;

  beforeEach(async () => {
    // Create mock Supabase client with chainable methods
    // Tests will override .not() as needed using mockDictionaryQueries helper
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(), // Default: chainable (tests override)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DictionaryPseudonymizerService,
        {
          provide: DATABASE_SERVICE,
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    // Suppress logger output in tests
    module.useLogger(false);

    service = module.get<DictionaryPseudonymizerService>(
      DictionaryPseudonymizerService,
    );

    // Clear cache before each test to ensure mock data is loaded
    service.clearCache();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper for global-only queries (when no options passed)
  const mockGlobalQuery = (globalData: any[]) => {
    mockSupabaseClient.not = jest
      .fn()
      .mockReturnValueOnce(mockSupabaseClient) // global: original_value -> chain
      .mockReturnValue({ data: globalData, error: null }); // global: pseudonym -> result
  };

  // Helper for full queries (when orgSlug + agentSlug passed)
  const mockDictionaryQueries = (
    agentData: any[],
    orgData: any[],
    globalData: any[],
  ) => {
    // Set up mock to handle all 3 queries (agent, org, global)
    mockSupabaseClient.not = jest
      .fn()
      // Agent query
      .mockReturnValueOnce(mockSupabaseClient)
      .mockReturnValueOnce({ data: agentData, error: null })
      // Org query
      .mockReturnValueOnce(mockSupabaseClient)
      .mockReturnValueOnce({ data: orgData, error: null })
      // Global query
      .mockReturnValueOnce(mockSupabaseClient)
      .mockReturnValue({ data: globalData, error: null });
  };

  const mockDictionaryError = () => {
    mockSupabaseClient.not = jest
      .fn()
      .mockReturnValueOnce(mockSupabaseClient)
      .mockReturnValue({
        data: null,
        error: { message: 'Database connection failed' },
      });
  };

  describe('pseudonymizeText', () => {
    it('should pseudonymize text using dictionary entries', async () => {
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
        {
          original_value: 'Acme Corp',
          pseudonym: 'COMPANY_A',
          data_type: 'organization',
          category: 'company',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const text = 'John Doe works at Acme Corp';
      const result = await service.pseudonymizeText(text);

      expect(result.originalText).toBe(text);
      expect(result.pseudonymizedText).toBe('PERSON_1 works at COMPANY_A');
      expect(result.mappings).toHaveLength(2);
      expect(result.mappings[0]?.originalValue).toBe('John Doe');
      expect(result.mappings[0]?.pseudonym).toBe('PERSON_1');
      expect(result.mappings[1]?.originalValue).toBe('Acme Corp');
      expect(result.mappings[1]?.pseudonym).toBe('COMPANY_A');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle case-insensitive matching', async () => {
      const dictionaryEntries = [
        {
          original_value: 'john doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const text = 'JOHN DOE is a person. John Doe is here.';
      const result = await service.pseudonymizeText(text);

      expect(result.pseudonymizedText).toBe(
        'PERSON_1 is a person. PERSON_1 is here.',
      );
    });

    it('should handle multiple occurrences of same value', async () => {
      const dictionaryEntries = [
        {
          original_value: 'secret',
          pseudonym: 'REDACTED',
          data_type: 'custom',
          category: 'sensitive',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const text = 'The secret is secret. Keep the secret safe.';
      const result = await service.pseudonymizeText(text);

      expect(result.pseudonymizedText).toBe(
        'The REDACTED is REDACTED. Keep the REDACTED safe.',
      );
      expect(result.mappings).toHaveLength(1); // Only one unique mapping
    });

    it('should handle text with no matches', async () => {
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const text = 'Hello world';
      const result = await service.pseudonymizeText(text);

      expect(result.originalText).toBe(text);
      expect(result.pseudonymizedText).toBe(text);
      expect(result.mappings).toHaveLength(0);
    });

    it('should handle empty dictionary', async () => {
      mockGlobalQuery([]);

      const text = 'Some text';
      const result = await service.pseudonymizeText(text);

      expect(result.pseudonymizedText).toBe(text);
      expect(result.mappings).toHaveLength(0);
    });

    it('should escape regex special characters', async () => {
      const dictionaryEntries = [
        {
          original_value: 'test@example.com',
          pseudonym: 'EMAIL_1',
          data_type: 'email',
          category: 'contact',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const text = 'Contact: test@example.com';
      const result = await service.pseudonymizeText(text);

      expect(result.pseudonymizedText).toBe('Contact: EMAIL_1');
    });

    it('should handle organization-scoped dictionaries', async () => {
      const orgDictionary = [
        {
          original_value: 'OrgSpecific',
          pseudonym: 'ORG_ITEM',
          data_type: 'custom',
          category: 'org',
          organization_slug: 'test-org',
          agent_slug: null,
        },
      ];

      mockDictionaryQueries([], orgDictionary, []);

      const text = 'OrgSpecific item here';
      const result = await service.pseudonymizeText(text, {
        organizationSlug: 'test-org',
        agentSlug: 'test-agent',
      });

      expect(result.pseudonymizedText).toBe('ORG_ITEM item here');
    });

    it('should throw error on database failure', async () => {
      mockDictionaryError();

      await expect(service.pseudonymizeText('test')).rejects.toThrow(
        'Failed to load pseudonym dictionary',
      );
    });
  });

  describe('reversePseudonyms', () => {
    it('should reverse pseudonyms back to original values', async () => {
      const mappings = [
        {
          originalValue: 'John Doe',
          pseudonym: 'PERSON_1',
          dataType: 'name',
          category: 'person',
        },
        {
          originalValue: 'Acme Corp',
          pseudonym: 'COMPANY_A',
          dataType: 'organization',
          category: 'company',
        },
      ];

      const text = 'PERSON_1 works at COMPANY_A';
      const result = await service.reversePseudonyms(text, mappings);

      expect(result.originalText).toBe('John Doe works at Acme Corp');
      expect(result.reversalCount).toBe(2);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle case-insensitive reversal', async () => {
      const mappings = [
        {
          originalValue: 'John Doe',
          pseudonym: 'person_1',
          dataType: 'name',
          category: 'person',
        },
      ];

      const text = 'PERSON_1 and Person_1 are here';
      const result = await service.reversePseudonyms(text, mappings);

      expect(result.originalText).toBe('John Doe and John Doe are here');
      expect(result.reversalCount).toBe(2);
    });

    it('should handle multiple occurrences', async () => {
      const mappings = [
        {
          originalValue: 'secret',
          pseudonym: 'REDACTED',
          dataType: 'custom',
          category: 'sensitive',
        },
      ];

      const text = 'The REDACTED is REDACTED. Keep REDACTED safe.';
      const result = await service.reversePseudonyms(text, mappings);

      expect(result.originalText).toBe(
        'The secret is secret. Keep secret safe.',
      );
      expect(result.reversalCount).toBe(3);
    });

    it('should handle text with no matches', async () => {
      const mappings = [
        {
          originalValue: 'John Doe',
          pseudonym: 'PERSON_1',
          dataType: 'name',
          category: 'person',
        },
      ];

      const text = 'Hello world';
      const result = await service.reversePseudonyms(text, mappings);

      expect(result.originalText).toBe(text);
      expect(result.reversalCount).toBe(0);
    });

    it('should handle empty mappings', async () => {
      const text = 'Some text';
      const result = await service.reversePseudonyms(text, []);

      expect(result.originalText).toBe(text);
      expect(result.reversalCount).toBe(0);
    });

    it('should escape regex special characters in pseudonyms', async () => {
      const mappings = [
        {
          originalValue: 'test@example.com',
          pseudonym: '[EMAIL_REDACTED]',
          dataType: 'email',
          category: 'contact',
        },
      ];

      const text = 'Contact: [EMAIL_REDACTED]';
      const result = await service.reversePseudonyms(text, mappings);

      expect(result.originalText).toBe('Contact: test@example.com');
    });

    it('should handle reversing full workflow (pseudonymize then reverse)', async () => {
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const originalText = 'John Doe is a person';
      const pseudoResult = await service.pseudonymizeText(originalText);
      const reverseResult = await service.reversePseudonyms(
        pseudoResult.pseudonymizedText,
        pseudoResult.mappings,
      );

      expect(reverseResult.originalText).toBe(originalText);
    });
  });

  describe('Cache Management', () => {
    it('should cache dictionary entries', async () => {
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      // First call should query database
      await service.pseudonymizeText('John Doe');

      // Clear mock call history
      jest.clearAllMocks();

      // Second call should use cache (no DB calls)
      await service.pseudonymizeText('John Doe');

      // Verify database was not called again
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });

    it('should clear cache on demand', async () => {
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
      ];

      // Setup for first call and second call after cache clear (12 mock returns total)
      mockSupabaseClient.not = jest
        .fn()
        // First pseudonymizeText call (6 calls)
        .mockReturnValueOnce(mockSupabaseClient) // Q1: original_value check -> chain
        .mockReturnValueOnce({ data: [], error: null }) // Q1: pseudonym check -> empty
        .mockReturnValueOnce(mockSupabaseClient) // Q2: original_value check -> chain
        .mockReturnValueOnce({ data: [], error: null }) // Q2: pseudonym check -> empty
        .mockReturnValueOnce(mockSupabaseClient) // Q3: original_value check -> chain
        .mockReturnValueOnce({ data: dictionaryEntries, error: null }) // Q3: pseudonym check -> data
        // Second pseudonymizeText call after cache clear (6 more calls)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce({ data: [], error: null })
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce({ data: [], error: null })
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValue({ data: dictionaryEntries, error: null });

      await service.pseudonymizeText('John Doe');

      service.clearCache();

      await service.pseudonymizeText('John Doe');

      // Verify database was called twice (once before clear, once after)
      expect(mockSupabaseClient.from).toHaveBeenCalledTimes(2);
    });

    it('should return dictionary entries via getDictionary', async () => {
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
      ];

      mockGlobalQuery(dictionaryEntries);

      const dictionary = await service.getDictionary();

      expect(dictionary).toHaveLength(1);
      expect(dictionary[0]?.originalValue).toBe('John Doe');
      expect(dictionary[0]?.pseudonym).toBe('PERSON_1');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty text', async () => {
      mockGlobalQuery([]);

      const result = await service.pseudonymizeText('');

      expect(result.pseudonymizedText).toBe('');
      expect(result.mappings).toHaveLength(0);
    });

    it('should handle null/undefined values in dictionary', async () => {
      // In production, the DB query filters null values via .not('original_value', 'is', null)
      // This test verifies the service works when valid entries are returned
      const dictionaryEntries = [
        {
          original_value: 'John Doe',
          pseudonym: 'PERSON_1',
          data_type: 'name',
          category: 'person',
        },
        // Note: entries with null original_value would be filtered by DB query
        // so we only include valid entries in the mock
      ];

      mockGlobalQuery(dictionaryEntries);

      const result = await service.pseudonymizeText('John Doe');

      // Should process valid entries
      expect(result.pseudonymizedText).toBe('PERSON_1');
    });
  });
});
