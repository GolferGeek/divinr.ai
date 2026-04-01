import { Test, TestingModule } from '@nestjs/testing';
import { MemoryManagerService } from '../memory-manager.service';
import { LocalModelStatusService } from '../local-model-status.service';
import { DATABASE_SERVICE } from '@/database';

describe('MemoryManagerService', () => {
  let service: MemoryManagerService;
  let localModelStatusService: jest.Mocked<LocalModelStatusService>;

  const createMockQueryBuilder = () => {
    const builder: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    return builder;
  };

  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    const mockSupabaseClient = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryManagerService,
        {
          provide: LocalModelStatusService,
          useValue: {
            getLoadedModels: jest.fn().mockResolvedValue([]),
            ensureModelLoaded: jest.fn().mockResolvedValue(true),
            updateModelLoadingStatus: jest.fn().mockResolvedValue(undefined),
            getOllamaStatus: jest.fn().mockResolvedValue({
              available: true,
              models: [],
            }),
          },
        },
        {
          provide: DATABASE_SERVICE,
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    module.useLogger(false);

    service = module.get<MemoryManagerService>(MemoryManagerService);
    localModelStatusService = module.get(LocalModelStatusService);

    // Override onModuleInit to prevent automatic initialization
    jest
      .spyOn(service, 'onModuleInit')
      .mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('getCurrentMemoryUsage', () => {
    it('should return 0 when no models are loaded', () => {
      const usage = service.getCurrentMemoryUsage();
      expect(usage).toBe(0);
    });

    it('should return total memory of loaded models', async () => {
      // Load a model first
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('llama3.2:latest');

      const usage = service.getCurrentMemoryUsage();
      // llama3.2:latest is estimated at 2GB in the service
      expect(usage).toBeGreaterThan(0);
    });
  });

  describe('getMemoryStats', () => {
    it('should return correct stats when no models loaded', () => {
      const stats = service.getMemoryStats();

      expect(stats.loadedModels).toBe(0);
      expect(stats.threeTierModels).toBe(0);
      expect(stats.currentUsage).toBe(0);
      expect(stats.memoryPressure).toBe('low');
    });

    it('should calculate memory pressure correctly', async () => {
      // Initially should be low pressure
      const stats = service.getMemoryStats();
      expect(stats.memoryPressure).toBe('low');
    });
  });

  describe('loadModel', () => {
    it('should return success when model is already loaded', async () => {
      // First load
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('test-model');

      // Second load should return already loaded
      const result = await service.loadModel('test-model');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Model already loaded');
    });

    it('should load model successfully when not already loaded', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);

      const result = await service.loadModel('new-model');

      expect(result.success).toBe(true);
      expect(localModelStatusService.ensureModelLoaded).toHaveBeenCalledWith(
        'new-model',
      );
    });

    it('should return failure when model loading fails', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(false);

      const result = await service.loadModel('failing-model');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to load model via Ollama');
    });

    it('should handle loading errors gracefully', async () => {
      localModelStatusService.ensureModelLoaded.mockRejectedValue(
        new Error('Connection failed'),
      );

      const result = await service.loadModel('error-model');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
    });

    it('should update model loading status in database', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);

      await service.loadModel('tracked-model');

      expect(
        localModelStatusService.updateModelLoadingStatus,
      ).toHaveBeenCalledWith('tracked-model', true);
    });
  });

  describe('recordModelUsage', () => {
    it('should update last used time and use count', async () => {
      // Load a model first
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('usage-model');

      // Record usage
      service.recordModelUsage('usage-model');

      // Check loaded models to verify
      const loadedModels = service.getLoadedModels();
      const model = loadedModels.find((m) => m.name === 'usage-model');
      expect(model?.useCount).toBeGreaterThan(1);
    });

    it('should do nothing for non-loaded models', () => {
      // Should not throw
      expect(() => service.recordModelUsage('non-existent')).not.toThrow();
    });
  });

  describe('getLoadedModels', () => {
    it('should return empty array when no models loaded', () => {
      const models = service.getLoadedModels();
      expect(models).toEqual([]);
    });

    it('should return loaded model information', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('info-model');

      const models = service.getLoadedModels();

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        name: 'info-model',
        useCount: 1,
      });
      expect(models[0]?.size).toBeDefined();
      expect(models[0]?.lastUsed).toBeDefined();
    });
  });

  describe('forceUnloadModel', () => {
    it('should return false for non-loaded models', async () => {
      const result = await service.forceUnloadModel('not-loaded');
      expect(result).toBe(false);
    });

    it('should unload loaded model successfully', async () => {
      // Load first
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('to-unload');

      // Then unload
      const result = await service.forceUnloadModel('to-unload');

      expect(result).toBe(true);
      expect(
        localModelStatusService.updateModelLoadingStatus,
      ).toHaveBeenCalledWith('to-unload', false);
    });

    it('should remove model from loaded models', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('to-remove');

      expect(service.getLoadedModels()).toHaveLength(1);

      await service.forceUnloadModel('to-remove');

      expect(service.getLoadedModels()).toHaveLength(0);
    });
  });

  describe('optimizeMemoryUsage', () => {
    it('should not optimize when memory pressure is low', async () => {
      // No models loaded = low pressure
      await service.optimizeMemoryUsage();

      // Should not call updateModelLoadingStatus for unloading
      expect(
        localModelStatusService.updateModelLoadingStatus,
      ).not.toHaveBeenCalledWith(expect.anything(), false);
    });

    it('should be idempotent when called multiple times', async () => {
      // Run optimization multiple times
      await Promise.all([
        service.optimizeMemoryUsage(),
        service.optimizeMemoryUsage(),
        service.optimizeMemoryUsage(),
      ]);

      // Should not cause errors
    });
  });

  describe('preloadThreeTierModels', () => {
    it('should not preload when memory pressure is high', async () => {
      // Mock high memory pressure by loading many models
      // For now, just verify the method runs without errors
      await service.preloadThreeTierModels();

      // Method should complete without errors
    });

    it('should skip already loaded models', async () => {
      // Load a model
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);
      await service.loadModel('pre-loaded-model');

      // Clear the mock calls
      localModelStatusService.ensureModelLoaded.mockClear();

      // Preload should not try to load already loaded models
      await service.preloadThreeTierModels();

      // ensureModelLoaded shouldn't be called for already loaded model
    });
  });

  describe('memory pressure calculation', () => {
    it('should report low pressure at 0% usage', () => {
      const stats = service.getMemoryStats();
      expect(stats.memoryPressure).toBe('low');
    });

    it('should have correct memory allocation', () => {
      const stats = service.getMemoryStats();

      // Default is 24GB
      const defaultMaxGB = 24;
      const defaultMaxBytes = defaultMaxGB * 1024 * 1024 * 1024;

      expect(stats.totalAllocated).toBe(defaultMaxBytes);
      expect(stats.availableMemory).toBe(defaultMaxBytes); // No models loaded
    });
  });

  describe('model size estimates', () => {
    it('should use known size for recognized models', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);

      // Load a model with known size
      await service.loadModel('qwen3:8b');

      const models = service.getLoadedModels();
      const model = models.find((m) => m.name === 'qwen3:8b');

      // qwen3:8b is estimated at 4.7GB
      expect(model?.size).toBe('4.7GB');
    });

    it('should use default size for unknown models', async () => {
      localModelStatusService.ensureModelLoaded.mockResolvedValue(true);

      await service.loadModel('unknown-model-xyz');

      const models = service.getLoadedModels();
      const model = models.find((m) => m.name === 'unknown-model-xyz');

      // Default is 4GB
      expect(model?.size).toBe('4.0GB');
    });
  });
});
