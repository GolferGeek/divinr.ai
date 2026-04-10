import { Test, TestingModule } from '@nestjs/testing';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';
import {
  AnthropicLLMService,
  createAnthropicService,
} from '../anthropic-llm.service';
import { PIIService } from '../../pii/pii.service';
import { DictionaryPseudonymizerService } from '../../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../../run-metadata.service';
import { ProviderConfigService } from '../../provider-config.service';
import { LLMPricingService } from '../../llm-pricing.service';
import { LLMServiceConfig, GenerateResponseParams } from '../llm-interfaces';
import { LLMError } from '../llm-error-handling';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help you?' }],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 50,
            output_tokens: 25,
          },
        }),
      },
    })),
  };
});

describe('AnthropicLLMService', () => {
  let service: AnthropicLLMService;
  let piiService: jest.Mocked<PIIService>;
  let dictionaryPseudonymizerService: jest.Mocked<DictionaryPseudonymizerService>;
  let runMetadataService: jest.Mocked<RunMetadataService>;
  let providerConfigService: jest.Mocked<ProviderConfigService>;
  let llmPricingService: jest.Mocked<LLMPricingService>;

  const mockConfig: LLMServiceConfig = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7,
    maxTokens: 1000,
    apiKey: 'test-api-key',
  };

  const mockExecutionContext = createMockExecutionContext({
    userId: 'user-123',
    conversationId: 'conv-123',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
  });

  beforeEach(async () => {
    // Set up mock environment
    process.env.ANTHROPIC_API_KEY = 'test-api-key';

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

    service = new AnthropicLLMService(
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
    delete process.env.ANTHROPIC_API_KEY;
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

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.metadata.provider).toBe('anthropic');
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

    it('should include Anthropic-specific metadata', async () => {
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
        stop_reason: 'end_turn',
        input_tokens: 50,
        output_tokens: 25,
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
        'anthropic',
        'claude-3-5-sonnet-20241022',
        50,
        25,
      );
      expect(response.metadata.usage.cost).toBe(0.001);
    });
  });

  describe('thinking extraction', () => {
    it('should extract thinking from <thinking> tags', async () => {
      // Get the mock to return content with thinking tags
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require('@anthropic-ai/sdk').default;
      Anthropic.mockImplementation(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '<thinking>Let me analyze this...</thinking>The answer is 42.',
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 50, output_tokens: 25 },
          }),
        },
      }));

      // Create new service with updated mock
      const newService = new AnthropicLLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'What is the meaning of life?',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const response = await newService.generateResponse(
        mockExecutionContext,
        params,
      );

      expect(response.content).toBe('The answer is 42.');
      expect(response.metadata.thinking).toBe('Let me analyze this...');
    });
  });

  describe('validateConfig', () => {
    it('should throw error when provider is not anthropic', () => {
      const invalidConfig: LLMServiceConfig = {
        provider: 'openai',
        model: 'gpt-4',
      };

      expect(() => {
        new AnthropicLLMService(
          invalidConfig,
          piiService,
          dictionaryPseudonymizerService,
          runMetadataService,
          providerConfigService,
          llmPricingService,
        );
      }).not.toThrow(); // Constructor doesn't validate, only generateResponse does

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: invalidConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      // This should throw during generateResponse
      expect(
        service.generateResponse(mockExecutionContext, {
          ...params,
          config: invalidConfig,
        }),
      ).rejects.toThrow(
        'AnthropicLLMService requires provider to be "anthropic"',
      );
    });

    it('should throw error when API key is missing', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const configWithoutKey: LLMServiceConfig = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        // No apiKey
      };

      const serviceWithoutKey = new AnthropicLLMService(
        configWithoutKey,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: configWithoutKey,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      expect(
        serviceWithoutKey.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow('Anthropic API key is required');
    });
  });

  describe('error handling', () => {
    it('should throw LLMError on API failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require('@anthropic-ai/sdk').default;
      Anthropic.mockImplementation(() => ({
        messages: {
          create: jest.fn().mockRejectedValue(new Error('API error')),
        },
      }));

      const newService = new AnthropicLLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await expect(
        newService.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow(LLMError);
    });

    it('should throw error when response has no content', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require('@anthropic-ai/sdk').default;
      Anthropic.mockImplementation(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [], // Empty content triggers Zod validation error
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 50, output_tokens: 0 },
          }),
        },
      }));

      const newService = new AnthropicLLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'System',
        userMessage: 'User',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      // Schema validation catches empty content before custom check
      await expect(
        newService.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow(LLMError);
    });
  });

  describe('createAnthropicService factory', () => {
    it('should create service with factory function', () => {
      const config: LLMServiceConfig = {
        provider: 'openai', // Will be overridden
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'test-key',
      };

      const dependencies = {
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
      };

      const newService = createAnthropicService(config, dependencies);

      expect(newService).toBeInstanceOf(AnthropicLLMService);
    });
  });

  describe('LangSmith integration', () => {
    beforeEach(() => {
      // Reset Anthropic mock to default behavior
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require('@anthropic-ai/sdk').default;
      Anthropic.mockImplementation(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello! How can I help you?' }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 50, output_tokens: 25 },
          }),
        },
      }));
    });

    it('should generate LangSmith run ID when enabled', async () => {
      process.env.LANGSMITH_API_KEY = 'test-langsmith-key';
      process.env.LANGSMITH_TRACING = 'true';

      // Create fresh service with updated mock
      const langsmithService = new AnthropicLLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const response = await langsmithService.generateResponse(
        mockExecutionContext,
        params,
      );

      expect(response.metadata.langsmithRunId).toMatch(
        /^anthropic-\d+-[a-z0-9]+$/,
      );

      delete process.env.LANGSMITH_API_KEY;
      delete process.env.LANGSMITH_TRACING;
    });

    it('should not generate LangSmith run ID when disabled', async () => {
      delete process.env.LANGSMITH_API_KEY;
      delete process.env.LANGSMITH_TRACING;

      // Create fresh service with updated mock
      const noLangsmithService = new AnthropicLLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        config: mockConfig,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      const response = await noLangsmithService.generateResponse(
        mockExecutionContext,
        params,
      );

      expect(response.metadata.langsmithRunId).toBeUndefined();
    });
  });
});
