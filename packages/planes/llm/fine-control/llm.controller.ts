import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { LLM_SERVICE, LLMServiceProvider } from '@orchestratorai/planes/llm';
import { isLLMResponse } from './services/llm-interfaces';
import { LocalModelStatusService } from './local-model-status.service';
import { RunMetadataService } from './run-metadata.service';
import { RecordLLMUsageDto } from './dto/record-llm-usage.dto';
import {
  OllamaStartupService,
  StartupSyncResult,
  ModelRecommendation,
} from './ollama-startup.service';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';

@Controller('llm')
export class LLMController {
  private readonly logger = new Logger(LLMController.name);

  constructor(
    @Inject(LLM_SERVICE) private readonly llmService: LLMServiceProvider,
    @Inject(LocalModelStatusService) private readonly localModelStatusService: LocalModelStatusService,
    @Inject(RunMetadataService) private readonly runMetadataService: RunMetadataService,
    @Inject(OllamaStartupService) private readonly ollamaStartupService: OllamaStartupService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body()
    request: {
      systemPrompt: string;
      userPrompt: string;
      /** Full ExecutionContext from LangGraph/external callers */
      context?: ExecutionContext;
      options?: {
        temperature?: number;
        maxTokens?: number;
        provider?: 'openai' | 'anthropic' | 'ollama' | 'google';
        // Support full LLM preferences from UI
        providerName?: string;
        modelName?: string;
        // Caller tracking for usage analytics
        callerType?: string;
        callerName?: string;
        // Individual context fields (deprecated - prefer passing full context)
        userId?: string;
        conversationId?: string;
        taskId?: string;
        dataClassification?: string;
      };
    },
  ): Promise<{
    response: string;
    content?: string;
    sanitizationMetadata?: Record<string, unknown>;
    piiMetadata?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }> {
    try {
      // Guard: Conversation-based requests from frontend should use agent tasks endpoint
      // But allow external API calls (like n8n, langgraph) to use conversationId for observability
      const allowedCallerTypes = ['external', 'langgraph'];
      if (
        request?.options?.conversationId &&
        !allowedCallerTypes.includes(request?.options?.callerType || '')
      ) {
        const guidance = {
          message:
            'Conversation-based requests must use the agent tasks endpoint to preserve agent + MCP context.',
          endpoint: '/agents/:agentType/:agentName/tasks',
          example: {
            url: '/agents/finance/metrics/tasks',
            body: {
              method: 'process',
              prompt: request.userPrompt,
              conversationId: request.options.conversationId,
              llmSelection: {
                providerName: request.options?.providerName,
                modelName: request.options?.modelName,
              },
            },
          },
        } as const;
        throw new BadRequestException(guidance);
      }

      const ctx = request.context;

      // Require ExecutionContext - callers must pass it
      if (!ctx) {
        throw new BadRequestException(
          'ExecutionContext is required. Pass "context" in the request body with conversationId, taskId, userId, agentSlug, provider, and model.',
        );
      }

      const result = await this.llmService.generateResponse(
        request.systemPrompt,
        request.userPrompt,
        {
          // LLM config overrides from options
          temperature: request.options?.temperature,
          maxTokens: request.options?.maxTokens,
          // Caller tracking
          callerType: request.options?.callerType || 'api',
          callerName: request.options?.callerName || 'llm-controller',
          dataClassification: request.options?.dataClassification || 'public',
          includeMetadata: true,
          // ExecutionContext is the single source of truth
          executionContext: ctx,
        },
      );

      // Handle both string and object responses
      if (typeof result === 'string') {
        return { response: result, content: result };
      }

      if (isLLMResponse(result)) {
        const sanitizationMetadata =
          result.sanitizationMetadata ??
          result.metadata.providerSpecific?.sanitizationMetadata ??
          null;

        const normalized = {
          response: result.content,
          content: result.content,
          sanitizationMetadata: (sanitizationMetadata ?? undefined) as
            | Record<string, unknown>
            | undefined,
          piiMetadata: (result.piiMetadata ?? undefined) as unknown as
            | Record<string, unknown>
            | undefined,
          metadata: result.metadata as unknown as Record<string, unknown>,
        };

        return normalized;
      }

      // Fallback: convert to string
      const fallback = String(result);
      return { response: fallback, content: fallback };
    } catch (error) {
      this.logger.error('Failed to generate response', error);
      throw error;
    }
  }

  @Get('local-models/status')
  @HttpCode(HttpStatus.OK)
  async getLocalModelStatus(): Promise<Record<string, unknown>> {
    try {
      const status = await this.localModelStatusService.getOllamaStatus();
      return status as unknown as Record<string, unknown>;
    } catch (error) {
      this.logger.error('Failed to get local model status', error);
      throw error;
    }
  }

  /**
   * Record LLM usage from external callers (e.g., LangGraph tools)
   *
   * This endpoint allows LangGraph tools that call specialized LLMs directly
   * (e.g., Ollama/SQLCoder) to report their usage for tracking and billing.
   */
  @Post('usage')
  @HttpCode(HttpStatus.CREATED)
  async recordUsage(
    @Body() usageDto: RecordLLMUsageDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.debug(
        `Recording LLM usage: ${usageDto.provider}/${usageDto.model} from ${usageDto.callerName}`,
      );

      await this.runMetadataService.insertCompletedUsage({
        provider: usageDto.provider,
        model: usageDto.model,
        isLocal: usageDto.provider.toLowerCase() === 'ollama',
        userId: usageDto.userId,
        callerType: usageDto.callerType,
        callerName: usageDto.callerName,
        conversationId: usageDto.conversationId,
        inputTokens: usageDto.promptTokens,
        outputTokens: usageDto.completionTokens,
        totalCost: undefined, // Let the service calculate from tokens
        startTime: usageDto.timestamp
          ? new Date(usageDto.timestamp).getTime() - (usageDto.latencyMs || 0)
          : Date.now() - (usageDto.latencyMs || 0),
        endTime: usageDto.timestamp
          ? new Date(usageDto.timestamp).getTime()
          : Date.now(),
        status: 'completed',
      });

      return {
        success: true,
        message: 'Usage recorded successfully',
      };
    } catch (error) {
      this.logger.error('Failed to record LLM usage', error);
      throw error;
    }
  }

  /**
   * Get all active LLM providers from the active provider plane.
   */
  @Get('providers')
  async getProviders(): Promise<
    Array<{
      name: string;
      displayName: string;
      status: string;
    }>
  > {
    return this.llmService.listProviders();
  }

  /**
   * Get models from the active provider plane, optionally filtered.
   *
   * @param provider  - Filter by provider name (e.g. "anthropic")
   * @param modelType - Filter by model type (e.g. "text-generation")
   * @param names     - Comma-separated model ID substrings to match
   *                    (e.g. "claude-sonnet,claude-opus,qwen2.5-coder")
   */
  @Get('models')
  async getModels(
    @Query('provider') provider?: string,
    @Query('modelType') modelType?: string,
    @Query('names') names?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      providerName: string;
      modelType: string;
      contextWindow?: number;
      maxOutputTokens?: number;
      isLocal?: boolean;
    }>
  > {
    let models = await this.llmService.listModels({ modelType });
    if (provider) {
      models = models.filter((m) => m.providerName === provider);
    }
    if (names) {
      const patterns = names.split(',').map((n) => n.trim().toLowerCase());
      models = models.filter((m) =>
        patterns.some((p) => m.id.toLowerCase().includes(p)),
      );
    }
    return models;
  }

  /**
   * Simple LLM endpoint for quick prompts without ExecutionContext.
   * Uses local Ollama provider by default for lightweight utility tasks.
   *
   * Use cases:
   * - Auto-generating form field content
   * - Simple text transformations
   * - Quick AI assistance features
   *
   * For conversation-based or tracked LLM calls, use the main /generate endpoint.
   */
  @Post('quick')
  @HttpCode(HttpStatus.OK)
  async quickGenerate(
    @Body()
    request: {
      systemPrompt: string;
      userPrompt: string;
      options?: {
        temperature?: number;
        maxTokens?: number;
        provider?: 'openai' | 'anthropic' | 'ollama' | 'google';
        model?: string;
      };
    },
  ): Promise<{ response: string }> {
    try {
      const provider = request.options?.provider || 'ollama';
      const model =
        request.options?.model ||
        (provider === 'ollama'
          ? process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b'
          : 'gpt-4o-mini');

      // Create a minimal execution context for the LLM service
      // This is a lightweight context for utility operations
      const minimalContext: ExecutionContext = {
        userId: 'system',
        conversationId: '00000000-0000-0000-0000-000000000000',
        agentSlug: 'quick-generate',
        agentType: 'utility',
        provider,
        model,
      };

      const result = await this.llmService.generateResponse(
        request.systemPrompt,
        request.userPrompt,
        {
          temperature: request.options?.temperature ?? 0.7,
          maxTokens: request.options?.maxTokens ?? 1000,
          callerType: 'utility',
          callerName: 'llm-quick-generate',
          executionContext: minimalContext,
        },
      );

      // Extract response content
      if (typeof result === 'string') {
        return { response: result };
      }

      // Handle LLMResponse object
      if (result && typeof result === 'object' && 'content' in result) {
        return { response: result.content };
      }

      return { response: String(result) };
    } catch (error) {
      this.logger.error('Quick generate failed', error);
      throw error;
    }
  }

  /**
   * Sync Ollama models with database.
   *
   * Triggers a full discovery and sync of Ollama models:
   * - Discovers working Ollama endpoint
   * - Fetches available models
   * - Syncs with llm_models table
   * - Updates global config if current model unavailable
   */
  @Post('sync-models')
  @HttpCode(HttpStatus.OK)
  async syncModels(): Promise<StartupSyncResult> {
    try {
      this.logger.log('Manual Ollama sync triggered');
      const result = await this.ollamaStartupService.triggerSync();

      if (result.success) {
        this.logger.log(
          `Sync complete: ${result.models.length} models at ${result.ollamaUrl}`,
        );
      } else {
        this.logger.warn(`Sync failed: ${result.warnings.join(', ')}`);
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to sync Ollama models', error);
      throw error;
    }
  }

  /**
   * Get recommended models for a given RAM size.
   *
   * @param ramGB System RAM in gigabytes (optional, returns all models if not specified)
   * @returns List of model recommendations with RAM requirements
   */
  @Get('recommended-models')
  @HttpCode(HttpStatus.OK)
  getRecommendedModels(
    @Query('ramGB') ramGBStr?: string,
  ): ModelRecommendation[] {
    try {
      const ramGB = ramGBStr ? parseInt(ramGBStr, 10) : undefined;

      if (ramGB !== undefined && !isNaN(ramGB)) {
        return this.ollamaStartupService.getRecommendedModelsForRAM(ramGB);
      }

      // Return all model requirements if no RAM specified
      return this.ollamaStartupService.getAllModelRequirements();
    } catch (error) {
      this.logger.error('Failed to get recommended models', error);
      throw error;
    }
  }
}
