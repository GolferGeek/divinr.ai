import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  createMockExecutionContext,
} from '@orchestrator-ai/transport-types';
import { BaseLLMService } from '../base-llm.service';
import { PIIService } from '../../pii/pii.service';
import {
  DictionaryPseudonymizerService,
  DictionaryPseudonymMapping,
} from '../../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../../run-metadata.service';
import { ProviderConfigService } from '../../provider-config.service';
import { LLMPricingService } from '../../llm-pricing.service';
import {
  LLMServiceConfig,
  GenerateResponseParams,
  LLMResponse,
  PiiOptions,
} from '../llm-interfaces';
import { LLMError } from '../llm-error-handling';

// Concrete implementation for testing the abstract BaseLLMService
class TestLLMService extends BaseLLMService {
  async generateResponse(
    _context: ExecutionContext,
    params: GenerateResponseParams,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const endTime = startTime + 100;
    const requestId = this.generateRequestId('test');

    return {
      content: `Response to: ${params.userMessage}`,
      metadata: this.createMetadata(
        { content: `Response to: ${params.userMessage}` },
        params,
        startTime,
        endTime,
        requestId,
      ),
    };
  }

  // Expose protected methods for testing
  public testCreateMetadata(
    rawResponse: unknown,
    params: GenerateResponseParams,
    startTime: number,
    endTime: number,
    requestId: string,
  ) {
    return this.createMetadata(
      rawResponse,
      params,
      startTime,
      endTime,
      requestId,
    );
  }

  public testHandlePiiInput(text: string, options: PiiOptions = {}) {
    return this.handlePiiInput(text, options);
  }

  public testHandlePiiOutput(
    text: string,
    requestId?: string,
    mappings?: Array<Record<string, unknown>>,
  ) {
    return this.handlePiiOutput(text, requestId, mappings);
  }

  public testTrackUsage(
    context: ExecutionContext,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cost?: number,
    requestMetadata?: {
      requestId?: string;
      piiMetadata?: Record<string, unknown>;
      startTime?: number;
      endTime?: number;
      callerType?: string;
      callerName?: string;
    },
  ) {
    return this.trackUsage(
      context,
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      requestMetadata,
    );
  }

  public testEstimateTokens(text: string) {
    return this.estimateTokens(text);
  }

  public testCalculateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ) {
    return this.calculateCost(provider, model, inputTokens, outputTokens);
  }

  public testHandleError(error: unknown, context: string): never {
    return this.handleError(error, context);
  }

  public testValidateConfig(config: LLMServiceConfig) {
    return this.validateConfig(config);
  }

  public testGenerateRequestId(prefix?: string) {
    return this.generateRequestId(prefix);
  }
}

describe('BaseLLMService', () => {
  let service: TestLLMService;
  let piiService: jest.Mocked<PIIService>;
  let dictionaryPseudonymizerService: jest.Mocked<DictionaryPseudonymizerService>;
  let runMetadataService: jest.Mocked<RunMetadataService>;
  let providerConfigService: jest.Mocked<ProviderConfigService>;
  let llmPricingService: jest.Mocked<LLMPricingService>;

  const mockConfig: LLMServiceConfig = {
    provider: 'test-provider',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 1000,
  };

  const mockExecutionContext: ExecutionContext = createMockExecutionContext({
    userId: 'user-123',
    conversationId: 'conv-123',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PIIService,
          useValue: {
            detectPII: jest.fn(),
            anonymize: jest.fn(),
          },
        },
        {
          provide: DictionaryPseudonymizerService,
          useValue: {
            pseudonymizeText: jest.fn().mockResolvedValue({
              originalText: 'original text',
              pseudonymizedText: 'pseudonymized text',
              mappings: [],
              processingTimeMs: 10,
            }),
            reversePseudonyms: jest.fn().mockResolvedValue({
              originalText: 'original text',
              reversalCount: 0,
              processingTimeMs: 5,
            }),
          },
        },
        {
          provide: RunMetadataService,
          useValue: {
            insertCompletedUsage: jest.fn().mockResolvedValue(undefined),
            startRun: jest.fn(),
            completeRun: jest.fn(),
          },
        },
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: jest.fn().mockReturnValue(mockConfig),
          },
        },
        {
          provide: LLMPricingService,
          useValue: {
            calculateCostSync: jest.fn().mockReturnValue(0.001),
            calculateCost: jest.fn().mockResolvedValue(0.001),
          },
        },
      ],
    }).compile();

    module.useLogger(false);

    piiService = module.get(PIIService);
    dictionaryPseudonymizerService = module.get(DictionaryPseudonymizerService);
    runMetadataService = module.get(RunMetadataService);
    providerConfigService = module.get(ProviderConfigService);
    llmPricingService = module.get(LLMPricingService);

    service = new TestLLMService(
      mockConfig,
      piiService,
      dictionaryPseudonymizerService,
      runMetadataService,
      providerConfigService,
      llmPricingService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMetadata', () => {
    it('should create valid metadata with all required fields', () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'You are a helpful assistant',
        userMessage: 'Hello',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const startTime = Date.now();
      const endTime = startTime + 100;
      const requestId = 'test-req-123';

      const metadata = service.testCreateMetadata(
        { content: 'Hello response' },
        params,
        startTime,
        endTime,
        requestId,
      );

      expect(metadata).toMatchObject({
        provider: 'test-provider',
        model: 'test-model',
        requestId: 'test-req-123',
        status: 'completed',
        tier: 'external',
      });
      expect(metadata.usage).toBeDefined();
      expect(metadata.usage.inputTokens).toBeGreaterThan(0);
      expect(metadata.usage.outputTokens).toBeGreaterThan(0);
      expect(metadata.timing.duration).toBe(100);
    });

    it('should set tier to local when preferLocal option is true', () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
          preferLocal: true,
        },
      };

      const metadata = service.testCreateMetadata(
        { content: 'response' },
        params,
        0,
        100,
        'req-123',
      );

      expect(metadata.tier).toBe('local');
    });

    it('should calculate cost using LLMPricingService', () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'System prompt',
        userMessage: 'User message',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const metadata = service.testCreateMetadata(
        { content: 'response' },
        params,
        0,
        100,
        'req-123',
      );

      expect(llmPricingService.calculateCostSync).toHaveBeenCalled();
      expect(metadata.usage.cost).toBe(0.001);
    });
  });

  describe('handlePiiInput', () => {
    it('should return original text when pseudonymization is disabled', async () => {
      const result = await service.testHandlePiiInput('Hello John Doe', {
        enablePseudonymization: false,
      });

      expect(result.processedText).toBe('Hello John Doe');
      expect(result.piiMetadata).toBeUndefined();
    });

    it('should use dictionary pseudonymizer when enabled', async () => {
      dictionaryPseudonymizerService.pseudonymizeText.mockResolvedValue({
        originalText: 'Hello John Doe',
        pseudonymizedText: 'Hello PERSON_1',
        mappings: [
          {
            originalValue: 'John Doe',
            pseudonym: 'PERSON_1',
            dataType: 'name',
            category: 'person',
          },
        ],
        processingTimeMs: 15,
      });

      const result = await service.testHandlePiiInput('Hello John Doe', {
        enablePseudonymization: true,
        useDictionaryPseudonymizer: true,
      });

      expect(result.processedText).toBe('Hello PERSON_1');
      expect(result.piiMetadata).toBeDefined();
      expect(result.piiMetadata?.piiDetected).toBe(true);
    });

    it('should return original text on processing error', async () => {
      dictionaryPseudonymizerService.pseudonymizeText.mockRejectedValue(
        new Error('Processing error'),
      );

      const result = await service.testHandlePiiInput('Hello John Doe', {
        enablePseudonymization: true,
        useDictionaryPseudonymizer: true,
      });

      expect(result.processedText).toBe('Hello John Doe');
    });

    it('should create proper PII metadata structure', async () => {
      dictionaryPseudonymizerService.pseudonymizeText.mockResolvedValue({
        originalText: 'Hello John',
        pseudonymizedText: 'Hello PERSON_1',
        mappings: [
          {
            originalValue: 'John',
            pseudonym: 'PERSON_1',
            dataType: 'name',
            category: 'person',
          },
        ],
        processingTimeMs: 10,
      });

      const result = await service.testHandlePiiInput('Hello John', {
        enablePseudonymization: true,
        useDictionaryPseudonymizer: true,
      });

      expect(result.piiMetadata).toMatchObject({
        piiDetected: true,
        showstopperDetected: false,
        processingFlow: 'pseudonymized',
      });
      expect(result.piiMetadata?.detectionResults.totalMatches).toBe(1);
    });
  });

  describe('handlePiiOutput', () => {
    it('should return original text when no requestId or mappings provided', async () => {
      const result = await service.testHandlePiiOutput('Hello PERSON_1');
      expect(result).toBe('Hello PERSON_1');
    });

    it('should reverse pseudonyms using dictionary mappings', async () => {
      const mappings: DictionaryPseudonymMapping[] = [
        {
          originalValue: 'John',
          pseudonym: 'PERSON_1',
          dataType: 'name',
          category: 'person',
        },
      ];

      dictionaryPseudonymizerService.reversePseudonyms.mockResolvedValue({
        originalText: 'Hello John',
        reversalCount: 1,
        processingTimeMs: 5,
      });

      const result = await service.testHandlePiiOutput(
        'Hello PERSON_1',
        undefined,
        mappings as unknown as Array<Record<string, unknown>>,
      );

      expect(result).toBe('Hello John');
      expect(
        dictionaryPseudonymizerService.reversePseudonyms,
      ).toHaveBeenCalled();
    });

    it('should handle errors gracefully and return original text', async () => {
      dictionaryPseudonymizerService.reversePseudonyms.mockRejectedValue(
        new Error('Reversal error'),
      );

      const result = await service.testHandlePiiOutput(
        'Hello PERSON_1',
        undefined,
        [{ originalValue: 'John', pseudonym: 'PERSON_1', dataType: 'name' }],
      );

      expect(result).toBe('Hello PERSON_1');
    });
  });

  describe('trackUsage', () => {
    it('should track usage when all required info is provided', async () => {
      await service.testTrackUsage(
        mockExecutionContext,
        'test-provider',
        'test-model',
        100,
        50,
        0.001,
        {
          requestId: 'req-123',
          startTime: Date.now() - 100,
          endTime: Date.now(),
          callerType: 'agent',
          callerName: 'test-agent',
        },
      );

      expect(runMetadataService.insertCompletedUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'test-provider',
          model: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalCost: 0.001,
          status: 'completed',
        }),
      );
    });

    it('should not track usage when startTime is missing', async () => {
      await service.testTrackUsage(
        mockExecutionContext,
        'test-provider',
        'test-model',
        100,
        50,
        0.001,
        {
          requestId: 'req-123',
          // Missing startTime
        },
      );

      expect(runMetadataService.insertCompletedUsage).not.toHaveBeenCalled();
    });

    it('should not track usage when userId is missing', async () => {
      // Create a context with empty userId to simulate missing user
      const contextWithoutUser = createMockExecutionContext({
            userId: '', // Empty userId simulates missing user
        conversationId: 'conv-123',
      });

      await service.testTrackUsage(
        contextWithoutUser,
        'test-provider',
        'test-model',
        100,
        50,
        0.001,
        {
          requestId: 'req-123',
          startTime: Date.now() - 100,
          endTime: Date.now(),
        },
      );

      expect(runMetadataService.insertCompletedUsage).not.toHaveBeenCalled();
    });

    it('should include PII metadata in enhanced metrics', async () => {
      await service.testTrackUsage(
        mockExecutionContext,
        'test-provider',
        'test-model',
        100,
        50,
        0.001,
        {
          requestId: 'req-123',
          startTime: Date.now() - 100,
          endTime: Date.now(),
          piiMetadata: {
            piiDetected: true,
            showstopperDetected: false,
            detectionResults: {
              dataTypesSummary: { name: 1 },
            },
          },
        },
      );

      expect(runMetadataService.insertCompletedUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          enhancedMetrics: expect.objectContaining({
            piiDetected: true,
            dataSanitizationApplied: true,
          }),
        }),
      );
    });

    it('should handle tracking errors gracefully', async () => {
      runMetadataService.insertCompletedUsage.mockRejectedValue(
        new Error('DB error'),
      );

      // Should not throw
      await expect(
        service.testTrackUsage(
          mockExecutionContext,
          'test-provider',
          'test-model',
          100,
          50,
          0.001,
          {
            requestId: 'req-123',
            startTime: Date.now() - 100,
            endTime: Date.now(),
          },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty text', () => {
      expect(service.testEstimateTokens('')).toBe(0);
    });

    it('should estimate tokens based on character count', () => {
      // 4 characters per token
      expect(service.testEstimateTokens('test')).toBe(1);
      expect(service.testEstimateTokens('12345678')).toBe(2);
      expect(service.testEstimateTokens('hello world test')).toBe(4);
    });

    it('should handle undefined/null text', () => {
      expect(service.testEstimateTokens(null as unknown as string)).toBe(0);
      expect(service.testEstimateTokens(undefined as unknown as string)).toBe(
        0,
      );
    });
  });

  describe('calculateCost', () => {
    it('should use LLMPricingService when available', () => {
      const cost = service.testCalculateCost('openai', 'gpt-4', 1000, 500);

      expect(llmPricingService.calculateCostSync).toHaveBeenCalledWith(
        'openai',
        'gpt-4',
        1000,
        500,
      );
      expect(cost).toBe(0.001);
    });

    it('should return undefined on pricing error', () => {
      llmPricingService.calculateCostSync.mockImplementation(() => {
        throw new Error('Pricing error');
      });

      const cost = service.testCalculateCost('openai', 'gpt-4', 1000, 500);
      expect(cost).toBeUndefined();
    });
  });

  describe('calculateCost without pricing service', () => {
    let serviceWithoutPricing: TestLLMService;

    beforeEach(() => {
      serviceWithoutPricing = new TestLLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        undefined, // No pricing service
      );
    });

    it('should use default pricing fallback', () => {
      const cost = serviceWithoutPricing.testCalculateCost(
        'openai',
        'gpt-4',
        1000,
        1000,
      );

      // Default: (1000/1000 * 0.001) + (1000/1000 * 0.002) = 0.003
      expect(cost).toBe(0.003);
    });
  });

  describe('handleError', () => {
    it('should throw LLMError for generic errors', () => {
      expect(() =>
        service.testHandleError(new Error('Test error'), 'Test context'),
      ).toThrow(LLMError);
    });

    it('should include provider and model in error', () => {
      try {
        service.testHandleError(new Error('Test error'), 'Test context');
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        expect((error as LLMError).provider).toBe('test-provider');
      }
    });

    it('should map errors using LLMErrorMapper', () => {
      try {
        service.testHandleError(
          { message: 'Rate limit', status: 429 },
          'API call',
        );
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
      }
    });
  });

  describe('validateConfig', () => {
    it('should throw error when provider is missing', () => {
      expect(() =>
        service.testValidateConfig({
          provider: '',
          model: 'test-model',
        }),
      ).toThrow('Provider must be specified');
    });

    it('should throw error when model is missing', () => {
      expect(() =>
        service.testValidateConfig({
          provider: 'test-provider',
          model: '',
        }),
      ).toThrow('Model must be specified');
    });

    it('should pass validation with valid config', () => {
      expect(() =>
        service.testValidateConfig({
          provider: 'test-provider',
          model: 'test-model',
        }),
      ).not.toThrow();
    });
  });

  describe('generateRequestId', () => {
    it('should generate unique request IDs', () => {
      const id1 = service.testGenerateRequestId();
      const id2 = service.testGenerateRequestId();

      expect(id1).not.toBe(id2);
    });

    it('should use custom prefix', () => {
      const id = service.testGenerateRequestId('custom');
      expect(id).toMatch(/^custom-\d+-[a-z0-9]+$/);
    });

    it('should use default prefix when not specified', () => {
      const id = service.testGenerateRequestId();
      expect(id).toMatch(/^req-\d+-[a-z0-9]+$/);
    });
  });

  describe('generateResponse', () => {
    it('should generate response with proper metadata', async () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const response = await service.generateResponse(
        mockExecutionContext,
        params,
      );

      expect(response.content).toBe('Response to: Hello');
      expect(response.metadata).toBeDefined();
      expect(response.metadata.provider).toBe('test-provider');
      expect(response.metadata.model).toBe('test-model');
      expect(response.metadata.status).toBe('completed');
    });
  });
});
