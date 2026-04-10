import { Test, TestingModule } from '@nestjs/testing';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';
import { OpenAILLMService, createOpenAIService } from '../openai-llm.service';
import { PIIService } from '../../pii/pii.service';
import { DictionaryPseudonymizerService } from '../../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../../run-metadata.service';
import { ProviderConfigService } from '../../provider-config.service';
import { LLMPricingService } from '../../llm-pricing.service';
import {
  LLMServiceConfig,
  GenerateResponseParams,
  ImageGenerationParams,
} from '../llm-interfaces';
import { LLMError } from '../llm-error-handling';

// Mock the OpenAI SDK
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Hello! How can I assist you today?',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 25,
              total_tokens: 75,
            },
            system_fingerprint: 'fp_123',
          }),
        },
      },
      images: {
        generate: jest.fn().mockResolvedValue({
          created: Date.now(),
          data: [
            {
              b64_json: Buffer.from('test-image').toString('base64'),
              revised_prompt: 'A beautiful sunset over mountains',
            },
          ],
        }),
      },
    })),
  };
});

describe('OpenAILLMService', () => {
  let service: OpenAILLMService;
  let piiService: jest.Mocked<PIIService>;
  let dictionaryPseudonymizerService: jest.Mocked<DictionaryPseudonymizerService>;
  let runMetadataService: jest.Mocked<RunMetadataService>;
  let providerConfigService: jest.Mocked<ProviderConfigService>;
  let llmPricingService: jest.Mocked<LLMPricingService>;

  const mockConfig: LLMServiceConfig = {
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 1000,
    apiKey: 'test-api-key',
  };

  const mockExecutionContext = createMockExecutionContext({
    userId: 'user-123',
    conversationId: 'conv-123',
    provider: 'openai',
    model: 'gpt-4',
  });

  beforeEach(async () => {
    // Set up mock environment
    process.env.OPENAI_API_KEY = 'test-api-key';

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

    service = new OpenAILLMService(
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
    delete process.env.OPENAI_API_KEY;
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

      expect(response.content).toBe('Hello! How can I assist you today?');
      expect(response.metadata.provider).toBe('openai');
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

    it('should include OpenAI-specific metadata', async () => {
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
        finish_reason: 'stop',
        system_fingerprint: 'fp_123',
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
        'openai',
        'gpt-4',
        50,
        25,
      );
      expect(response.metadata.usage.cost).toBe(0.001);
    });
  });

  describe('validateConfig', () => {
    it('should throw error when provider is not openai', async () => {
      const invalidConfig: LLMServiceConfig = {
        provider: 'anthropic',
        model: 'claude-3',
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
      ).rejects.toThrow('OpenAILLMService requires provider to be "openai"');
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;

      const configWithoutKey: LLMServiceConfig = {
        provider: 'openai',
        model: 'gpt-4',
        // No apiKey
      };

      const serviceWithoutKey = new OpenAILLMService(
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

      await expect(
        serviceWithoutKey.generateResponse(mockExecutionContext, params),
      ).rejects.toThrow('OpenAI API key is required');
    });
  });

  describe('error handling', () => {
    it('should throw LLMError on API failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require('openai').default;
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(new Error('API error')),
          },
        },
      }));

      const newService = new OpenAILLMService(
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
      const OpenAI = require('openai').default;
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'chatcmpl-123',
              object: 'chat.completion',
              created: Date.now(),
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: null, // No content
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 0,
                total_tokens: 50,
              },
            }),
          },
        },
      }));

      const newService = new OpenAILLMService(
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
  });

  describe('generateImage', () => {
    beforeEach(() => {
      // Reset OpenAI mock to default behavior for image tests
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require('openai').default;
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'chatcmpl-123',
              object: 'chat.completion',
              created: Date.now(),
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Hello!' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 25,
                total_tokens: 75,
              },
            }),
          },
        },
        images: {
          generate: jest.fn().mockResolvedValue({
            created: Date.now(),
            data: [
              {
                b64_json: Buffer.from('test-image-data').toString('base64'),
                revised_prompt: 'A beautiful sunset',
              },
            ],
          }),
        },
      }));
    });

    it('should generate image successfully', async () => {
      const imageService = new OpenAILLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const imageContext = createMockExecutionContext({
        ...mockExecutionContext,
        model: 'dall-e-3',
      });

      const params: ImageGenerationParams = {
        prompt: 'A beautiful sunset over mountains',
        size: '1024x1024',
        quality: 'standard',
      };

      const response = await imageService.generateImage(imageContext, params);

      expect(response.images).toHaveLength(1);
      expect(response.metadata.status).toBe('completed');
      expect(response.images[0]?.data).toBeInstanceOf(Buffer);
    });

    it('should return error response on image generation failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require('openai').default;
      OpenAI.mockImplementation(() => ({
        chat: { completions: { create: jest.fn() } },
        images: {
          generate: jest.fn().mockRejectedValue(new Error('Image API error')),
        },
      }));

      const imageService = new OpenAILLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: ImageGenerationParams = {
        prompt: 'A sunset',
      };

      const response = await imageService.generateImage(
        mockExecutionContext,
        params,
      );

      expect(response.images).toHaveLength(0);
      expect(response.metadata.status).toBe('error');
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe('OPENAI_IMAGE_GENERATION_FAILED');
    });

    it('should include revised prompt in response', async () => {
      const imageService = new OpenAILLMService(
        mockConfig,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: ImageGenerationParams = {
        prompt: 'A sunset',
      };

      const response = await imageService.generateImage(
        mockExecutionContext,
        params,
      );

      expect(response.images[0]?.revisedPrompt).toBe('A beautiful sunset');
    });
  });

  describe('createOpenAIService factory', () => {
    it('should create service with factory function', () => {
      const config: LLMServiceConfig = {
        provider: 'anthropic', // Will be overridden
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      const dependencies = {
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
      };

      const newService = createOpenAIService(config, dependencies);

      expect(newService).toBeInstanceOf(OpenAILLMService);
    });
  });

  describe('model-specific handling', () => {
    it('should handle o1 model temperature restrictions', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require('openai').default;
      const createMock = jest.fn().mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'o1-preview',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Reasoning response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
      });

      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: createMock,
          },
        },
      }));

      const o1Config: LLMServiceConfig = {
        provider: 'openai',
        model: 'o1-preview',
        apiKey: 'test-key',
        temperature: 0.8, // Should be ignored for o1 models
      };

      const o1Service = new OpenAILLMService(
        o1Config,
        piiService,
        dictionaryPseudonymizerService,
        runMetadataService,
        providerConfigService,
        llmPricingService,
      );

      const params: GenerateResponseParams = {
        systemPrompt: 'You are helpful',
        userMessage: 'Explain reasoning',
        config: o1Config,
        options: {
          executionContext: mockExecutionContext,
        },
      };

      await o1Service.generateResponse(mockExecutionContext, params);

      // o1 models should not have temperature set
      const callArgs = createMock.mock.calls[0][0];
      expect(callArgs.temperature).toBeUndefined();
    });
  });

  describe('LangSmith integration', () => {
    beforeEach(() => {
      // Reset OpenAI mock to default behavior
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require('openai').default;
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'chatcmpl-123',
              object: 'chat.completion',
              created: Date.now(),
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Hello!' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 25,
                total_tokens: 75,
              },
              system_fingerprint: 'fp_123',
            }),
          },
        },
      }));
    });

    it('should generate LangSmith run ID when enabled', async () => {
      process.env.LANGSMITH_API_KEY = 'test-langsmith-key';
      process.env.LANGSMITH_TRACING = 'true';

      const langsmithService = new OpenAILLMService(
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
        /^openai-\d+-[a-z0-9]+$/,
      );

      delete process.env.LANGSMITH_API_KEY;
      delete process.env.LANGSMITH_TRACING;
    });
  });
});
