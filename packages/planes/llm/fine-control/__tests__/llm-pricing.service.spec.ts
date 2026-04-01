import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  LLMPricingService,
  ModelPricing as _ModelPricing,
} from '../llm-pricing.service';
import { DATABASE_SERVICE } from '@/database';

describe('LLMPricingService', () => {
  let service: LLMPricingService;
  let mockSupabaseClient: any;

  const mockModels = [
    {
      model_name: 'gpt-4',
      provider_name: 'openai',
      pricing_info_json: {
        input_per_1k: 0.03,
        output_per_1k: 0.06,
      },
    },
    {
      model_name: 'claude-3-opus',
      provider_name: 'anthropic',
      pricing_info_json: {
        input_per_1k: 0.015,
        output_per_1k: 0.075,
      },
    },
    {
      model_name: 'claude-sonnet-4',
      provider_name: 'anthropic',
      pricing_info_json: {
        input_per_1k: 0.003,
        output_per_1k: 0.015,
        cached_input_per_1k: 0.0003,
        thinking_per_1k: 0.012,
      },
    },
    {
      model_name: 'gemini-1.5-flash',
      provider_name: 'google',
      pricing_info_json: {
        input_per_1k: 0.00015,
        output_per_1k: 0.0006,
      },
    },
  ];

  const mockProviders = [
    {
      name: 'openai',
      display_name: 'OpenAI',
      is_local: false,
    },
    {
      name: 'anthropic',
      display_name: 'Anthropic',
      is_local: false,
    },
    {
      name: 'google',
      display_name: 'Google',
      is_local: false,
    },
    {
      name: 'ollama',
      display_name: 'Ollama',
      is_local: true,
    },
  ];

  beforeEach(async () => {
    // Mock Supabase client
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMPricingService,
        {
          provide: DATABASE_SERVICE,
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    // Disable logging during tests
    module.useLogger(false);

    service = module.get<LLMPricingService>(LLMPricingService);

    // Mock logger to suppress warnings during tests
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('loadPricingCache', () => {
    it('should load pricing data from database', async () => {
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();

      expect(mockSupabaseClient.from).toHaveBeenCalledWith(null, 'llm_models');
      expect(mockSupabaseClient.select).toHaveBeenCalledWith(
        'model_name, provider_name, pricing_info_json',
      );
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('is_active', true);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded pricing for 4 models'),
      );
    });

    it('should handle database errors gracefully', async () => {
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: null,
        error: { message: 'Database error' },
      });

      await service.loadPricingCache();

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to load pricing cache:',
        { message: 'Database error' },
      );
    });

    it('should handle missing Supabase client gracefully', async () => {
      mockSupabaseClient.from.mockImplementation(() => {
        throw new Error('Client not available');
      });

      await service.loadPricingCache();

      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('should clear existing cache before loading new data', async () => {
      // Load initial data
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();

      // Load again with different data
      const newModels = [
        {
          model_name: 'new-model',
          provider_name: 'new-provider',
          pricing_info_json: {
            input_per_1k: 0.001,
            output_per_1k: 0.002,
          },
        },
      ];

      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: newModels,
        error: null,
      });

      await service.loadPricingCache();

      expect(Logger.prototype.log).toHaveBeenLastCalledWith(
        'Loaded pricing for 1 models',
      );
    });

    it('should handle null pricing data', async () => {
      const modelsWithNullPricing = [
        {
          model_name: 'test-model',
          provider_name: 'test-provider',
          pricing_info_json: null,
        },
      ];

      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: modelsWithNullPricing,
        error: null,
      });

      await service.loadPricingCache();

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Loaded pricing for 0 models',
      );
    });

    it('should handle invalid pricing data', async () => {
      const modelsWithInvalidPricing = [
        {
          model_name: 'test-model',
          provider_name: 'test-provider',
          pricing_info_json: {
            input_per_1k: 'invalid', // Should be number
            output_per_1k: 0.002,
          },
        },
      ];

      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: modelsWithInvalidPricing,
        error: null,
      });

      await service.loadPricingCache();

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Loaded pricing for 0 models',
      );
    });
  });

  describe('getModelPricing', () => {
    beforeEach(async () => {
      // Load cache with mock data
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();
      jest.clearAllMocks();
    });

    it('should return cached pricing for exact match', async () => {
      const pricing = await service.getModelPricing('openai', 'gpt-4');

      expect(pricing).toEqual({
        inputPer1k: 0.03,
        outputPer1k: 0.06,
        cachedInputPer1k: undefined,
        thinkingPer1k: undefined,
      });
    });

    it('should be case-insensitive', async () => {
      const pricing = await service.getModelPricing('OpenAI', 'GPT-4');

      expect(pricing).toEqual({
        inputPer1k: 0.03,
        outputPer1k: 0.06,
        cachedInputPer1k: undefined,
        thinkingPer1k: undefined,
      });
    });

    it('should return pricing with optional fields', async () => {
      const pricing = await service.getModelPricing(
        'anthropic',
        'claude-sonnet-4',
      );

      expect(pricing).toEqual({
        inputPer1k: 0.003,
        outputPer1k: 0.015,
        cachedInputPer1k: 0.0003,
        thinkingPer1k: 0.012,
      });
    });

    it('should find partial matches for versioned models', async () => {
      const pricing = await service.getModelPricing(
        'anthropic',
        'claude-sonnet-4-20250514',
      );

      expect(pricing).toEqual({
        inputPer1k: 0.003,
        outputPer1k: 0.015,
        cachedInputPer1k: 0.0003,
        thinkingPer1k: 0.012,
      });
    });

    it('should fetch from database if not in cache', async () => {
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: {
          pricing_info_json: {
            input_per_1k: 0.005,
            output_per_1k: 0.01,
          },
        },
        error: null,
      });

      const pricing = await service.getModelPricing('unknown', 'new-model');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith(null, 'llm_models');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith(
        'provider_name',
        'unknown',
      );
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith(
        'model_name',
        'new-model',
      );
      expect(pricing).toEqual({
        inputPer1k: 0.005,
        outputPer1k: 0.01,
        cachedInputPer1k: undefined,
        thinkingPer1k: undefined,
      });
    });

    it('should return default pricing for unknown models', async () => {
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const pricing = await service.getModelPricing('unknown', 'unknown-model');

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'No pricing found for unknown/unknown-model, using default',
      );
      expect(pricing).toEqual({
        inputPer1k: 0.001,
        outputPer1k: 0.002,
      });
    });

    it('should refresh cache after TTL expires', async () => {
      // Fast-forward time beyond TTL (5 minutes)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);

      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.getModelPricing('openai', 'gpt-4');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith(null, 'llm_models');
    });
  });

  describe('calculateCost', () => {
    beforeEach(async () => {
      // Load cache with mock data
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();
      jest.clearAllMocks();
    });

    it('should calculate cost for input and output tokens', async () => {
      const result = await service.calculateCost('openai', 'gpt-4', 1000, 500);

      expect(result).toEqual({
        inputCost: 0.03, // (1000 / 1000) * 0.03
        outputCost: 0.03, // (500 / 1000) * 0.06
        cachedInputCost: undefined,
        thinkingCost: undefined,
        totalCost: 0.06,
      });
    });

    it('should calculate cost with cached input tokens', async () => {
      const result = await service.calculateCost(
        'anthropic',
        'claude-sonnet-4',
        1000,
        500,
        {
          cachedInputTokens: 2000,
        },
      );

      expect(result.inputCost).toBeCloseTo(0.003, 4);
      expect(result.outputCost).toBeCloseTo(0.0075, 4);
      expect(result.cachedInputCost).toBeCloseTo(0.0006, 4);
      expect(result.thinkingCost).toBeUndefined();
      expect(result.totalCost).toBeCloseTo(0.0111, 4);
    });

    it('should calculate cost with thinking tokens', async () => {
      const result = await service.calculateCost(
        'anthropic',
        'claude-sonnet-4',
        1000,
        500,
        {
          thinkingTokens: 1000,
        },
      );

      expect(result).toEqual({
        inputCost: 0.003,
        outputCost: 0.0075,
        cachedInputCost: undefined,
        thinkingCost: 0.012, // (1000 / 1000) * 0.012
        totalCost: 0.0225,
      });
    });

    it('should calculate cost with all token types', async () => {
      const result = await service.calculateCost(
        'anthropic',
        'claude-sonnet-4',
        1000,
        500,
        {
          cachedInputTokens: 2000,
          thinkingTokens: 1000,
        },
      );

      expect(result).toEqual({
        inputCost: 0.003,
        outputCost: 0.0075,
        cachedInputCost: 0.0006,
        thinkingCost: 0.012,
        totalCost: 0.0231,
      });
    });

    it('should handle zero tokens', async () => {
      const result = await service.calculateCost('openai', 'gpt-4', 0, 0);

      expect(result).toEqual({
        inputCost: 0,
        outputCost: 0,
        cachedInputCost: undefined,
        thinkingCost: undefined,
        totalCost: 0,
      });
    });

    it('should not include cached cost if model does not support it', async () => {
      const result = await service.calculateCost('openai', 'gpt-4', 1000, 500, {
        cachedInputTokens: 2000,
      });

      expect(result.cachedInputCost).toBeUndefined();
      expect(result.totalCost).toBe(0.06); // Only input + output
    });

    it('should handle fractional token counts', async () => {
      const result = await service.calculateCost(
        'google',
        'gemini-1.5-flash',
        1500,
        750,
      );

      expect(result).toEqual({
        inputCost: 0.000225, // (1500 / 1000) * 0.00015
        outputCost: 0.00045, // (750 / 1000) * 0.0006
        cachedInputCost: undefined,
        thinkingCost: undefined,
        totalCost: 0.000675,
      });
    });

    it('should use default pricing for unknown models', async () => {
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await service.calculateCost(
        'unknown',
        'unknown-model',
        1000,
        1000,
      );

      expect(result).toEqual({
        inputCost: 0.001, // (1000 / 1000) * 0.001 (default)
        outputCost: 0.002, // (1000 / 1000) * 0.002 (default)
        cachedInputCost: undefined,
        thinkingCost: undefined,
        totalCost: 0.003,
      });
    });
  });

  describe('calculateCostSync', () => {
    beforeEach(async () => {
      // Load cache with mock data
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();
      jest.clearAllMocks();
    });

    it('should calculate cost synchronously from cache', () => {
      const cost = service.calculateCostSync('openai', 'gpt-4', 1000, 500);

      expect(cost).toBe(0.06); // (1000/1000)*0.03 + (500/1000)*0.06
    });

    it('should handle partial matches', () => {
      const cost = service.calculateCostSync(
        'anthropic',
        'claude-sonnet-4-20250514',
        1000,
        500,
      );

      expect(cost).toBeCloseTo(0.0105, 4); // (1000/1000)*0.003 + (500/1000)*0.015
    });

    it('should use default pricing if not in cache', () => {
      const cost = service.calculateCostSync(
        'unknown',
        'unknown-model',
        1000,
        1000,
      );

      expect(cost).toBe(0.003); // (1000/1000)*0.001 + (1000/1000)*0.002 (default)
    });

    it('should handle zero tokens', () => {
      const cost = service.calculateCostSync('openai', 'gpt-4', 0, 0);

      expect(cost).toBe(0);
    });

    it('should be case-insensitive', () => {
      const cost = service.calculateCostSync('OpenAI', 'GPT-4', 1000, 500);

      expect(cost).toBe(0.06);
    });
  });

  describe('getModelsWithPricing', () => {
    it('should return all models with pricing', async () => {
      const modelsWithDisplayInfo = mockModels.map((m) => ({
        ...m,
        display_name: `${m.provider_name} ${m.model_name}`,
        model_tier: 'standard',
        speed_tier: 'medium',
        is_local: false,
      }));

      // Mock the chain: from -> select -> eq -> order -> order -> order
      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: modelsWithDisplayInfo, error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockChain);

      const result = await service.getModelsWithPricing();

      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        provider: 'openai',
        model: 'gpt-4',
        displayName: expect.any(String),
        inputPer1k: 0.03,
        outputPer1k: 0.06,
        modelTier: 'standard',
        speedTier: 'medium',
        isLocal: false,
      });
    });

    it('should filter models by provider', async () => {
      const anthropicModels = mockModels
        .filter((m) => m.provider_name === 'anthropic')
        .map((m) => ({
          ...m,
          display_name: `Anthropic ${m.model_name}`,
          model_tier: 'premium',
          speed_tier: 'fast',
          is_local: false,
        }));

      // Mock the chain with provider filter
      // Chain: from -> select -> eq(is_active) -> order -> order -> order -> eq(provider)
      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) => resolve({ data: anthropicModels, error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient); // is_active
      mockSupabaseClient.order
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockChain); // provider filter

      const result = await service.getModelsWithPricing('anthropic');

      expect(result).toHaveLength(2);
      expect(result.every((m) => m.provider === 'anthropic')).toBe(true);
    });

    it('should use default pricing for models without pricing_info_json', async () => {
      const modelWithoutPricing = [
        {
          model_name: 'test-model',
          provider_name: 'test-provider',
          display_name: 'Test Model',
          pricing_info_json: null,
          model_tier: 'standard',
          speed_tier: 'medium',
          is_local: false,
        },
      ];

      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: modelWithoutPricing, error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockChain);

      const result = await service.getModelsWithPricing();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        inputPer1k: 0.001, // Default
        outputPer1k: 0.002, // Default
      });
    });

    it('should handle database errors gracefully', async () => {
      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: null, error: { message: 'Database error' } }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockChain);

      const result = await service.getModelsWithPricing();

      expect(result).toEqual([]);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to get models with pricing:',
        { message: 'Database error' },
      );
    });

    it('should use model_name as displayName if display_name is null', async () => {
      const modelsWithoutDisplayName = [
        {
          model_name: 'test-model',
          provider_name: 'test-provider',
          display_name: null,
          pricing_info_json: {
            input_per_1k: 0.001,
            output_per_1k: 0.002,
          },
          model_tier: 'standard',
          speed_tier: 'medium',
          is_local: false,
        },
      ];

      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: modelsWithoutDisplayName, error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockChain);

      const result = await service.getModelsWithPricing();

      expect(result[0]?.displayName).toBe('test-model');
    });

    it('should use default tier values if null', async () => {
      const modelsWithNullTiers = [
        {
          model_name: 'test-model',
          provider_name: 'test-provider',
          display_name: 'Test',
          pricing_info_json: {
            input_per_1k: 0.001,
            output_per_1k: 0.002,
          },
          model_tier: null,
          speed_tier: null,
          is_local: false,
        },
      ];

      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: modelsWithNullTiers, error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockSupabaseClient)
        .mockReturnValueOnce(mockChain);

      const result = await service.getModelsWithPricing();

      expect(result[0]).toMatchObject({
        modelTier: 'standard',
        speedTier: 'medium',
      });
    });
  });

  describe('getProviders', () => {
    it('should return all active providers', async () => {
      mockSupabaseClient.order.mockResolvedValueOnce({
        data: mockProviders,
        error: null,
      });

      const result = await service.getProviders();

      expect(result).toHaveLength(4);
      expect(result).toEqual([
        { name: 'openai', displayName: 'OpenAI', isLocal: false },
        { name: 'anthropic', displayName: 'Anthropic', isLocal: false },
        { name: 'google', displayName: 'Google', isLocal: false },
        { name: 'ollama', displayName: 'Ollama', isLocal: true },
      ]);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith(
        null,
        'llm_providers',
      );
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('is_active', true);
      expect(mockSupabaseClient.order).toHaveBeenCalledWith('display_name');
    });

    it('should handle null is_local field', async () => {
      const providersWithNullLocal = [
        {
          name: 'test-provider',
          display_name: 'Test Provider',
          is_local: null,
        },
      ];

      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: providersWithNullLocal, error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order.mockReturnValueOnce(mockChain);

      const result = await service.getProviders();

      expect(result[0]?.isLocal).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) =>
          resolve({ data: null, error: { message: 'Database error' } }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order.mockReturnValueOnce(mockChain);

      const result = await service.getProviders();

      expect(result).toEqual([]);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to get providers:',
        { message: 'Database error' },
      );
    });

    it('should return empty array when no providers exist', async () => {
      const mockChain = {
        ...mockSupabaseClient,
        then: (resolve: any) => resolve({ data: [], error: null }),
      };

      mockSupabaseClient.from.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.select.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.eq.mockReturnValueOnce(mockSupabaseClient);
      mockSupabaseClient.order.mockReturnValueOnce(mockChain);

      const result = await service.getProviders();

      expect(result).toEqual([]);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle exceptions in loadPricingCache', async () => {
      mockSupabaseClient.eq.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await service.loadPricingCache();

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Error loading pricing cache:',
        expect.any(Error),
      );
    });

    it('should handle exceptions in fetchModelPricing', async () => {
      mockSupabaseClient.single.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const pricing = await service.getModelPricing('test', 'test-model');

      expect(pricing).toEqual({
        inputPer1k: 0.001,
        outputPer1k: 0.002,
      });
    });

    it('should handle exceptions in getModelsWithPricing', async () => {
      mockSupabaseClient.order.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await service.getModelsWithPricing();

      expect(result).toEqual([]);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Error getting models with pricing:',
        expect.any(Error),
      );
    });

    it('should handle exceptions in getProviders', async () => {
      mockSupabaseClient.order.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await service.getProviders();

      expect(result).toEqual([]);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Error getting providers:',
        expect.any(Error),
      );
    });
  });

  describe('cache TTL behavior', () => {
    beforeEach(async () => {
      // Load initial cache
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();
      jest.clearAllMocks();
    });

    it('should not refresh cache if TTL has not expired', async () => {
      // Fast-forward time by 2 minutes (less than 5 minute TTL)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 1000);

      await service.getModelPricing('openai', 'gpt-4');

      // Should not call database
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });

    it('should refresh cache if TTL has expired', async () => {
      // Fast-forward time by 6 minutes (more than 5 minute TTL)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);

      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.getModelPricing('openai', 'gpt-4');

      // Should call database to refresh cache
      expect(mockSupabaseClient.from).toHaveBeenCalledWith(null, 'llm_models');
    });
  });

  describe('pricing calculation precision', () => {
    beforeEach(async () => {
      mockSupabaseClient.eq.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: mockModels,
        error: null,
      });

      await service.loadPricingCache();
      jest.clearAllMocks();
    });

    it('should handle very small costs without floating point errors', async () => {
      const result = await service.calculateCost(
        'google',
        'gemini-1.5-flash',
        100,
        100,
      );

      expect(result.inputCost).toBeCloseTo(0.000015, 8);
      expect(result.outputCost).toBeCloseTo(0.00006, 8);
      expect(result.totalCost).toBeCloseTo(0.000075, 8);
    });

    it('should handle large token counts', async () => {
      const result = await service.calculateCost(
        'openai',
        'gpt-4',
        1000000,
        500000,
      );

      expect(result.inputCost).toBe(30); // (1000000 / 1000) * 0.03
      expect(result.outputCost).toBe(30); // (500000 / 1000) * 0.06
      expect(result.totalCost).toBe(60);
    });
  });
});
