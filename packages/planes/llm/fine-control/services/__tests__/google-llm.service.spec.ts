import { Test, TestingModule } from '@nestjs/testing';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';
import { GoogleLLMService, createGoogleService } from '../google-llm.service';
import { PIIService } from '../../pii/pii.service';
import { DictionaryPseudonymizerService } from '../../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../../run-metadata.service';
import { ProviderConfigService } from '../../provider-config.service';
import { LLMPricingService } from '../../llm-pricing.service';
import { LLMServiceConfig, GenerateResponseParams } from '../llm-interfaces';
import { LLMError } from '../llm-error-handling';

// Mock the Google SDK
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    })),
    FinishReason: {
      STOP: 'STOP',
      MAX_TOKENS: 'MAX_TOKENS',
      SAFETY: 'SAFETY',
      RECITATION: 'RECITATION',
      OTHER: 'OTHER',
    },
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
      HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
      HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    },
    HarmBlockThreshold: {
      BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
    },
  };
});

describe('GoogleLLMService', () => {
  let service: GoogleLLMService;
  let piiService: jest.Mocked<PIIService>;
  let dictionaryPseudonymizerService: jest.Mocked<DictionaryPseudonymizerService>;
  let runMetadataService: jest.Mocked<RunMetadataService>;
  let providerConfigService: jest.Mocked<ProviderConfigService>;
  let llmPricingService: jest.Mocked<LLMPricingService>;

  const mockConfig: LLMServiceConfig = {
    provider: 'google',
    model: 'gemini-1.5-flash',
    temperature: 0.7,
    maxTokens: 1000,
    apiKey: 'test-api-key',
  };

  const mockExecutionContext = createMockExecutionContext({
    userId: 'user-123',
    conversationId: 'conv-123',
    provider: 'google',
    model: 'gemini-1.5-flash',
  });

  const mockGoogleResponse = {
    response: {
      text: () => 'Hello! I am Gemini, how can I help you?',
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 25,
        totalTokenCount: 75,
      },
      candidates: [
        {
          finishReason: 'STOP',
          safetyRatings: [
            { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
          ],
        },
      ],
    },
  };

  beforeEach(async () => {
    // Set up mock environment
    process.env.GOOGLE_API_KEY = 'test-api-key';

    // Reset mock to default behavior
    mockGenerateContent.mockResolvedValue(mockGoogleResponse);

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
              originalText: 'text',
              pseudonymizedText: 'text',
              mappings: [],
              processingTimeMs: 10,
            }),
            reversePseudonyms: jest.fn().mockResolvedValue({
              originalText: 'text',
              reversalCount: 0,
              processingTimeMs: 5,
            }),
          },
        },
        {
          provide: RunMetadataService,
          useValue: {
            insertCompletedUsage: jest.fn().mockResolvedValue(undefined),
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

    service = new GoogleLLMService(
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
    delete process.env.GOOGLE_API_KEY;
  });

  describe('generateResponse', () => {
    it('should generate response successfully', async () => {
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

      expect(response.content).toBe('Hello! I am Gemini, how can I help you?');
      expect(response.metadata.provider).toBe('google');
      expect(response.metadata.status).toBe('completed');
    });

    it('should include usage metadata', async () => {
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

      expect(response.metadata.usage.inputTokens).toBe(50);
      expect(response.metadata.usage.outputTokens).toBe(25);
      expect(response.metadata.usage.totalTokens).toBe(75);
    });

    it('should include Google-specific metadata', async () => {
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

      expect(response.metadata.providerSpecific).toMatchObject({
        finish_reason: 'STOP',
        prompt_token_count: 50,
        candidates_token_count: 25,
      });
    });

    it('should track usage in database', async () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await service.generateResponse(mockExecutionContext, params);

      expect(runMetadataService.insertCompletedUsage).toHaveBeenCalled();
    });

    it('should calculate cost using pricing service', async () => {
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

      expect(llmPricingService.calculateCostSync).toHaveBeenCalledWith(
        'google',
        'gemini-1.5-flash',
        50,
        25,
      );
      expect(response.metadata.usage.cost).toBe(0.001);
    });

    it('should include safety ratings in metadata', async () => {
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

      expect(response.metadata.providerSpecific?.safety_ratings).toBeDefined();
      expect(response.metadata.providerSpecific?.safety_ratings).toHaveLength(
        1,
      );
    });
  });

  describe('validateConfig', () => {
    it('should throw error when provider is not google', async () => {
      const invalidConfig: LLMServiceConfig = {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: invalidConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await expect(
        service.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow('GoogleLLMService requires provider to be "google"');
    });

    it('should throw error when API key is missing', () => {
      delete process.env.GOOGLE_API_KEY;

      const configWithoutKey: LLMServiceConfig = {
        provider: 'google',
        model: 'gemini-1.5-flash',
        // No apiKey
      };

      expect(() => {
        new GoogleLLMService(
          configWithoutKey,
          piiService,
          dictionaryPseudonymizerService,
          runMetadataService,
          providerConfigService,
          llmPricingService,
        );
      }).toThrow('Google API key is required');
    });
  });

  describe('error handling', () => {
    it('should throw LLMError on API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API error'));

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await expect(
        service.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow(LLMError);
    });

    it('should throw error when response has no content', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '', // Empty content
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 0,
            totalTokenCount: 50,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await expect(
        service.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow('No content in Google response');
    });

    it('should throw error when response shape is unexpected', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          // Missing text() method
        },
      });

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await expect(
        service.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow('Unexpected Google response shape');
    });
  });

  describe('finish reason mapping', () => {
    it('should map STOP finish reason correctly', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Response text',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: { executionContext: mockExecutionContext },
      };

      const response = await service.generateResponse(
        mockExecutionContext,
        params,
      );
      expect(response.metadata.providerSpecific?.finish_reason).toBe('STOP');
    });

    it('should map MAX_TOKENS finish reason correctly', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Truncated response',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 100,
            totalTokenCount: 110,
          },
          candidates: [{ finishReason: 'MAX_TOKENS' }],
        },
      });

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: { executionContext: mockExecutionContext },
      };

      const response = await service.generateResponse(
        mockExecutionContext,
        params,
      );
      expect(response.metadata.providerSpecific?.finish_reason).toBe(
        'MAX_TOKENS',
      );
    });

    it('should map SAFETY finish reason correctly', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Safe content',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
          candidates: [{ finishReason: 'SAFETY' }],
        },
      });

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: { executionContext: mockExecutionContext },
      };

      const response = await service.generateResponse(
        mockExecutionContext,
        params,
      );
      expect(response.metadata.providerSpecific?.finish_reason).toBe('SAFETY');
    });
  });

  describe('createGoogleService factory', () => {
    it('should create service with factory function', () => {
      process.env.GOOGLE_API_KEY = 'test-key';

      const config: LLMServiceConfig = {
        provider: 'openai', // Will be overridden
        model: 'gemini-1.5-flash',
        apiKey: 'test-key',
      };

      const dependencies = {
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
      };

      const newService = createGoogleService(config, dependencies);

      expect(newService).toBeInstanceOf(GoogleLLMService);
    });
  });

  describe('LangSmith integration', () => {
    it('should generate LangSmith run ID when enabled', async () => {
      process.env.LANGSMITH_API_KEY = 'test-langsmith-key';
      process.env.LANGSMITH_TRACING = 'true';

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

      expect(response.metadata.langsmithRunId).toMatch(
        /^google-\d+-[a-z0-9]+$/,
      );

      delete process.env.LANGSMITH_API_KEY;
      delete process.env.LANGSMITH_TRACING;
    });

    it('should not generate LangSmith run ID when disabled', async () => {
      delete process.env.LANGSMITH_API_KEY;
      delete process.env.LANGSMITH_TRACING;

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

      expect(response.metadata.langsmithRunId).toBeUndefined();
    });
  });

  describe('generation config', () => {
    it('should include generation config in metadata', async () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        config: {
          ...mockConfig,
          temperature: 0.9,
          maxTokens: 2000,
        },
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const response = await service.generateResponse(
        mockExecutionContext,
        params,
      );

      expect(
        response.metadata.providerSpecific?.generation_config,
      ).toMatchObject({
        temperature: 0.9,
        max_output_tokens: 2000,
        top_p: 0.95,
        top_k: 64,
      });
    });

    it('should use option temperature over config temperature', async () => {
      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        config: {
          ...mockConfig,
          temperature: 0.5,
        },
        options: {
          executionContext: mockExecutionContext,
          temperature: 0.9, // Option takes precedence
        },
      };

      const response = await service.generateResponse(
        mockExecutionContext,
        params,
      );

      const generationConfig = response.metadata.providerSpecific
        ?.generation_config as { temperature?: number } | undefined;
      expect(generationConfig?.temperature).toBe(0.9);
    });
  });
});
