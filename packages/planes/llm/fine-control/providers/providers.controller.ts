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
import { ProvidersService } from './providers.service';
import {
  CreateProviderDto,
  UpdateProviderDto,
  ProviderResponseDto,
  ModelResponseDto,
  ProviderNameDto,
  ProviderWithModelsDto,
} from '../dto/llm-evaluation.dto';
import { LLM_SERVICE, LLMServiceProvider } from '@orchestratorai/planes/llm';

@ApiTags('LLM Providers')
@Controller('providers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    @Inject(LLM_SERVICE) private readonly llmService: LLMServiceProvider,
  ) {}

  @Get('names')
  @Public()
  @ApiOperation({
    summary: 'Get provider names only (optimized for frontend dropdowns)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'deprecated'],
    description: 'Filter by provider status',
  })
  @ApiResponse({
    status: 200,
    description: 'List of provider names',
    type: [ProviderNameDto],
  })
  async getProviderNames(
    @Query('status') _status?: 'active' | 'inactive' | 'deprecated',
  ): Promise<ProviderNameDto[]> {
    const planeProviders = await this.llmService.listProviders();
    return planeProviders.map((p) => ({ name: p.name }));
  }

  @Get('with-models')
  @Public()
  @ApiOperation({
    summary:
      'Get providers with their available models (optimized for frontend)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'deprecated'],
    description: 'Filter by provider status',
  })
  @ApiQuery({
    name: 'sovereign_mode',
    required: false,
    type: Boolean,
    description: 'Filter models based on sovereign mode compliance',
  })
  @ApiResponse({
    status: 200,
    description: 'List of providers with their models',
    type: [ProviderWithModelsDto],
  })
  async getProvidersWithModels(
    @Query('status') status?: 'active' | 'inactive' | 'deprecated',
    @Query('sovereign_mode') sovereignMode?: boolean,
  ): Promise<ProviderWithModelsDto[]> {
    // Delegate to the active LLM plane
    const [planeProviders, planeModels] = await Promise.all([
      this.llmService.listProviders(),
      this.llmService.listModels({ sovereignMode }),
    ]);

    // Group models by provider
    const modelsByProvider = new Map<string, typeof planeModels>();
    for (const m of planeModels) {
      const existing = modelsByProvider.get(m.providerName) ?? [];
      existing.push(m);
      modelsByProvider.set(m.providerName, existing);
    }

    return planeProviders.map((p) => ({
      id: p.name,
      name: p.name,
      display_name: p.displayName,
      is_active: true,
      models: (modelsByProvider.get(p.name) ?? []).map((m) => ({
        providerName: m.providerName,
        modelName: m.id,
        displayName: m.name,
      })),
    }));
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all LLM providers (full details)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'deprecated'],
    description: 'Filter by provider status',
  })
  @ApiQuery({
    name: 'sovereign_mode',
    required: false,
    type: Boolean,
    description:
      'Filter providers based on sovereign mode compliance (true = only local/ollama providers)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of LLM providers',
    type: [ProviderResponseDto],
  })
  async getProviders(
    @Query('status') _status?: 'active' | 'inactive' | 'deprecated',
    @Query('sovereign_mode') _sovereignMode?: boolean,
  ): Promise<ProviderResponseDto[]> {
    // Delegate to the active LLM plane for dynamic provider discovery
    const planeProviders = await this.llmService.listProviders();
    return planeProviders.map((p) => ({
      name: p.name,
      authType: 'api_key' as const,
      status: p.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a specific LLM provider by ID' })
  @ApiParam({ name: 'id', description: 'Provider UUID' })
  @ApiResponse({
    status: 200,
    description: 'Provider details',
    type: ProviderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getProvider(@Param('id') id: string): Promise<ProviderResponseDto> {
    const provider = await this.providersService.findOne(id);
    if (!provider) {
      throw new HttpException('Provider not found', HttpStatus.NOT_FOUND);
    }
    return provider;
  }

  @Get(':id/models')
  @ApiOperation({ summary: 'Get all models for a specific provider' })
  @ApiParam({ name: 'id', description: 'Provider UUID' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'deprecated'],
    description: 'Filter by model status',
  })
  @ApiResponse({
    status: 200,
    description: 'List of models for the provider',
    type: [ModelResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getProviderModels(
    @Param('id') providerId: string,
    @Query('status') status?: 'active' | 'inactive' | 'deprecated',
  ): Promise<ModelResponseDto[]> {
    const provider = await this.providersService.findOne(providerId);
    if (!provider) {
      throw new HttpException('Provider not found', HttpStatus.NOT_FOUND);
    }
    return this.providersService.findModelsByProvider(providerId, status);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new LLM provider (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Provider created successfully',
    type: ProviderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Provider name already exists' })
  async createProvider(
    @Body() createProviderDto: CreateProviderDto,
  ): Promise<ProviderResponseDto> {
    return this.providersService.create(createProviderDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an LLM provider (Admin only)' })
  @ApiParam({ name: 'id', description: 'Provider UUID' })
  @ApiResponse({
    status: 200,
    description: 'Provider updated successfully',
    type: ProviderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async updateProvider(
    @Param('id') id: string,
    @Body() updateProviderDto: UpdateProviderDto,
  ): Promise<ProviderResponseDto> {
    const provider = await this.providersService.update(id, updateProviderDto);
    if (!provider) {
      throw new HttpException('Provider not found', HttpStatus.NOT_FOUND);
    }
    return provider;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an LLM provider (Admin only)' })
  @ApiParam({ name: 'id', description: 'Provider UUID' })
  @ApiResponse({ status: 200, description: 'Provider deleted successfully' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete provider with existing models',
  })
  async deleteProvider(@Param('id') id: string): Promise<{ message: string }> {
    const deleted = await this.providersService.delete(id);
    if (!deleted) {
      throw new HttpException('Provider not found', HttpStatus.NOT_FOUND);
    }
    return { message: 'Provider deleted successfully' };
  }
}
