import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  UseGuards,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Public } from '@/auth/decorators/public.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { ModelsService } from './models.service';
import {
  CreateModelDto,
  UpdateModelDto,
  ModelResponseDto,
  CostEstimateDto,
  CostEstimateResponseDto,
  ModelNameDto,
} from '../dto/llm-evaluation.dto';
import { LLM_SERVICE, LLMServiceProvider } from '@orchestratorai/planes/llm';

@ApiTags('LLM Models')
@Controller('models')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ModelsController {
  constructor(
    @Inject(ModelsService) private readonly modelsService: ModelsService,
    @Inject(LLM_SERVICE) private readonly llmService: LLMServiceProvider,
  ) {}

  @Get('names')
  @Public()
  @ApiOperation({
    summary: 'Get model names only (optimized for frontend dropdowns)',
  })
  @ApiQuery({
    name: 'provider_name',
    required: false,
    description: 'Filter by provider name',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'deprecated'],
    description: 'Filter by model status',
  })
  @ApiQuery({
    name: 'sovereign_mode',
    required: false,
    type: Boolean,
    description: 'Filter models based on sovereign mode compliance',
  })
  @ApiQuery({
    name: 'model_type',
    required: false,
    enum: [
      'text-generation',
      'image-generation',
      'video-generation',
      'reasoning',
      'code-generation',
    ],
    description:
      'Filter by model type (text-generation, image-generation, video-generation)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of model names with provider info',
    type: [ModelNameDto],
  })
  async getModelNames(
    @Query('provider_name') providerName?: string,
    @Query('status') status?: 'active' | 'inactive' | 'deprecated',
    @Query('sovereign_mode') sovereignMode?: boolean,
    @Query('model_type')
    modelType?:
      | 'text-generation'
      | 'image-generation'
      | 'video-generation'
      | 'reasoning'
      | 'code-generation',
  ): Promise<ModelNameDto[]> {
    const planeModels = await this.llmService.listModels({
      modelType,
      sovereignMode,
    });
    let filtered = planeModels;
    if (providerName) {
      filtered = filtered.filter((m) => m.providerName === providerName);
    }
    return filtered.map((m) => ({
      providerName: m.providerName,
      modelName: m.id,
      displayName: m.name,
    }));
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all LLM models (full details)' })
  @ApiQuery({
    name: 'provider_id',
    required: false,
    description: 'Filter by provider UUID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'deprecated'],
    description: 'Filter by model status',
  })
  @ApiQuery({
    name: 'supports_thinking',
    required: false,
    type: Boolean,
    description: 'Filter by thinking mode support',
  })
  @ApiQuery({
    name: 'include_provider',
    required: false,
    type: Boolean,
    description: 'Include provider details in response',
  })
  @ApiQuery({
    name: 'sovereign_mode',
    required: false,
    type: Boolean,
    description:
      'Filter models based on sovereign mode compliance (true = only local/ollama models)',
  })
  @ApiQuery({
    name: 'names',
    required: false,
    description:
      'Comma-separated model name substrings to filter (e.g. "claude-sonnet-4.6,qwen2.5-coder")',
  })
  @ApiQuery({
    name: 'model_type',
    required: false,
    enum: [
      'text-generation',
      'image-generation',
      'video-generation',
      'reasoning',
      'code-generation',
    ],
    description:
      'Filter by model type (text-generation, image-generation, video-generation)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of LLM models',
    type: [ModelResponseDto],
  })
  async getModels(
    @Query('provider_name') providerName?: string,
    @Query('status') status?: 'active' | 'inactive' | 'deprecated',
    @Query('supports_thinking') supportsThinking?: boolean,
    @Query('include_provider') includeProvider?: boolean,
    @Query('sovereign_mode') sovereignMode?: boolean,
    @Query('names') names?: string,
    @Query('model_type')
    modelType?:
      | 'text-generation'
      | 'image-generation'
      | 'video-generation'
      | 'reasoning'
      | 'code-generation',
  ): Promise<ModelResponseDto[]> {
    const planeModels = await this.llmService.listModels({
      modelType,
      sovereignMode,
    });
    let filtered = planeModels;
    if (providerName) {
      filtered = filtered.filter((m) => m.providerName === providerName);
    }
    if (supportsThinking) {
      filtered = filtered.filter((m) => m.capabilities?.includes('reasoning'));
    }
    if (names) {
      const nameList = names.split(',').map((n) => n.trim().toLowerCase());
      filtered = filtered.filter((m) =>
        nameList.some(
          (n) =>
            m.id.toLowerCase().includes(n) || m.name.toLowerCase().includes(n),
        ),
      );
    }
    return filtered.map((m) => ({
      id: m.id,
      providerName: m.providerName,
      name: m.name,
      modelName: m.id,
      modelType: m.modelType ?? 'text-generation',
      isLocal: m.isLocal ?? false,
      pricingInputPer1k: m.pricing?.inputPer1M
        ? m.pricing.inputPer1M / 1000
        : undefined,
      pricingOutputPer1k: m.pricing?.outputPer1M
        ? m.pricing.outputPer1M / 1000
        : undefined,
      supportsThinking: m.capabilities?.includes('reasoning') ?? false,
      maxTokens: m.maxOutputTokens,
      contextWindow: m.contextWindow,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific LLM model by ID' })
  @ApiParam({ name: 'id', description: 'Model UUID' })
  @ApiQuery({
    name: 'include_provider',
    required: false,
    type: Boolean,
    description: 'Include provider details in response',
  })
  @ApiResponse({
    status: 200,
    description: 'Model details',
    type: ModelResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async getModel(
    @Param('id') id: string,
    @Query('include_provider') includeProvider?: boolean,
  ): Promise<ModelResponseDto> {
    const model = await this.modelsService.findOne(id, includeProvider);
    if (!model) {
      throw new HttpException('Model not found', HttpStatus.NOT_FOUND);
    }
    return model;
  }

  @Get('by-model-name/:modelName')
  @ApiOperation({ summary: 'Get model by API model name (e.g., gpt-4o)' })
  @ApiParam({ name: 'modelName', description: 'API Model name (e.g., gpt-4o)' })
  @ApiQuery({
    name: 'provider_name',
    required: false,
    description: 'Provider name to narrow search',
  })
  @ApiResponse({
    status: 200,
    description: 'Model details',
    type: ModelResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Model not found' })
  async getModelByModelName(
    @Param('modelName') modelName: string,
    @Query('provider_name') providerName?: string,
  ): Promise<ModelResponseDto> {
    const model = await this.modelsService.findByModelId(
      modelName,
      providerName,
    );
    if (!model) {
      throw new HttpException('Model not found', HttpStatus.NOT_FOUND);
    }
    return model;
  }

  @Post('estimate-cost')
  @ApiOperation({ summary: 'Estimate cost for a message with specific model' })
  @ApiResponse({
    status: 200,
    description: 'Cost estimation',
    type: CostEstimateResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Model not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async estimateCost(
    @Body() costEstimateDto: CostEstimateDto,
  ): Promise<CostEstimateResponseDto> {
    return this.modelsService.estimateCost(costEstimateDto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new LLM model (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Model created successfully',
    type: ModelResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  @ApiResponse({
    status: 409,
    description: 'Model ID already exists for provider',
  })
  async createModel(
    @Body() createModelDto: CreateModelDto,
  ): Promise<ModelResponseDto> {
    return this.modelsService.create(createModelDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an LLM model (Admin only)' })
  @ApiParam({ name: 'id', description: 'Model UUID' })
  @ApiResponse({
    status: 200,
    description: 'Model updated successfully',
    type: ModelResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Model not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async updateModel(
    @Param('id') id: string,
    @Body() updateModelDto: UpdateModelDto,
  ): Promise<ModelResponseDto> {
    const model = await this.modelsService.update(id, updateModelDto);
    if (!model) {
      throw new HttpException('Model not found', HttpStatus.NOT_FOUND);
    }
    return model;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an LLM model (Admin only)' })
  @ApiParam({ name: 'id', description: 'Model UUID' })
  @ApiResponse({ status: 200, description: 'Model deleted successfully' })
  @ApiResponse({ status: 404, description: 'Model not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete model with existing usage',
  })
  async deleteModel(@Param('id') id: string): Promise<{ message: string }> {
    const deleted = await this.modelsService.delete(id);
    if (!deleted) {
      throw new HttpException('Model not found', HttpStatus.NOT_FOUND);
    }
    return { message: 'Model deleted successfully' };
  }

  @Get('recommendations/for-use-case')
  @ApiOperation({ summary: 'Get model recommendations for specific use cases' })
  @ApiQuery({
    name: 'use_case',
    required: true,
    description: 'Use case (e.g., "code generation", "reasoning", "chat")',
  })
  @ApiQuery({
    name: 'max_cost',
    required: false,
    type: Number,
    description: 'Maximum cost per 1K tokens',
  })
  @ApiQuery({
    name: 'min_context',
    required: false,
    type: Number,
    description: 'Minimum context window size',
  })
  @ApiResponse({
    status: 200,
    description: 'Recommended models for the use case',
    type: [ModelResponseDto],
  })
  async getRecommendations(
    @Query('use_case') useCase: string,
    @Query('max_cost') maxCost?: number,
    @Query('min_context') minContext?: number,
  ): Promise<ModelResponseDto[]> {
    return this.modelsService.getRecommendations({
      useCase,
      maxCost,
      minContext,
    });
  }
}
