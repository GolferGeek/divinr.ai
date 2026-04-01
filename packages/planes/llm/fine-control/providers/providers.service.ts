import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import {
  CreateProviderDto,
  UpdateProviderDto,
  ProviderResponseDto,
  ModelResponseDto,
  ProviderNameDto,
  ProviderWithModelsDto,
} from '../dto/llm-evaluation.dto';
import { ProviderStatus, ModelStatus } from '../types/llm-evaluation';
import {
  mapLLMProviderFromDb,
  mapLLMModelFromDb,
} from '@/utils/case-converter';
import { getTableName } from '@orchestratorai/planes/database';

@Injectable()
export class ProvidersService {
  private readonly providerNamesCache = new Map<
    string,
    { data: ProviderNameDto[]; timestamp: number }
  >();
  private readonly providersWithModelsCache = new Map<
    string,
    { data: ProviderWithModelsDto[]; timestamp: number }
  >();
  private readonly cacheExpirationMs = 5 * 60 * 1000; // 5 minutes

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  async findAllNames(status?: ProviderStatus): Promise<ProviderNameDto[]> {
    const cacheKey = `names:${status || 'all'}`;
    const cached = this.providerNamesCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheExpirationMs) {
      return cached.data;
    }

    let query = this.db
      .from(null, getTableName('llm_providers'))
      .select('name')
      .order('name');

    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    }

    const { data, error } = (await query) as QueryResult<unknown>;

    if (error) {
      throw new HttpException(
        `Failed to fetch provider names: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const rows = data as Array<{ name: string }> | null;
    const result = (rows || []).map((row) => ({ name: row.name }));

    // Cache the result
    this.providerNamesCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    return result;
  }

  async findAllWithModels(
    status?: ProviderStatus,
    sovereignMode?: boolean,
  ): Promise<ProviderWithModelsDto[]> {
    const cacheKey = `with-models:${status || 'all'}:${sovereignMode || 'false'}`;
    const cached = this.providersWithModelsCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheExpirationMs) {
      return cached.data;
    }

    // First get providers (include is_active for admin purposes)
    let providerQuery = this.db
      .from(null, getTableName('llm_providers'))
      .select('name, display_name, is_local, is_active')
      .order('name');

    if (status) {
      // Map status to is_active boolean
      const isActive = status === 'active';
      providerQuery = providerQuery.eq('is_active', isActive);
    }

    if (sovereignMode) {
      // In sovereign mode, only show local providers (is_local = true OR name = 'ollama')
      providerQuery = providerQuery.or('is_local.eq.true,name.ilike.ollama');
    }

    const { data: providers, error: providerError } =
      (await providerQuery) as QueryResult<unknown>;

    if (providerError) {
      throw new HttpException(
        `Failed to fetch providers: ${providerError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Then get models for each provider
    const result: ProviderWithModelsDto[] = [];

    const typedProviders = (providers || []) as Array<{
      name: string;
      display_name?: string;
      is_local?: boolean;
      is_active?: boolean;
    }>;
    for (const provider of typedProviders) {
      const typedProvider = provider as {
        name: string;
        display_name?: string;
        is_local?: boolean;
        is_active?: boolean;
      };
      const providerName = typedProvider.name;

      // Get all models for admin purposes (include model_tier, context_window)
      const modelQuery = this.db
        .from(null, getTableName('llm_models'))
        .select(
          'provider_name, model_name, display_name, is_active, model_tier, context_window',
        )
        .eq('provider_name', providerName)
        .order('display_name');

      const { data: models, error: modelError } =
        (await modelQuery) as QueryResult<unknown>;

      if (modelError) {
        throw new HttpException(
          `Failed to fetch models for provider ${providerName}: ${modelError.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      result.push({
        id: providerName, // Use name as id since it's the primary key
        name: providerName,
        display_name: typedProvider.display_name,
        is_local: typedProvider.is_local,
        is_active: typedProvider.is_active,
        models: ((models || []) as Array<Record<string, unknown>>).map(
          (model) => {
            const typedModel = model as {
              provider_name: string;
              model_name: string;
              display_name: string;
              is_active: boolean;
              model_tier?: string;
              context_window?: number;
            };
            return {
              providerName: typedModel.provider_name,
              modelName: typedModel.model_name,
              displayName: typedModel.display_name,
              is_active: typedModel.is_active,
              model_tier: typedModel.model_tier,
              context_window: typedModel.context_window,
            };
          },
        ),
      });
    }

    // Cache the result
    this.providersWithModelsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    return result;
  }

  async findAll(
    status?: ProviderStatus,
    sovereignMode?: boolean,
  ): Promise<ProviderResponseDto[]> {
    // Try service client first to bypass RLS
    let query = this.db
      .from(null, getTableName('llm_providers'))
      .select('*')
      .order('name');

    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    }

    if (sovereignMode) {
      // In sovereign mode, only show local providers (is_local = true OR name = 'ollama')
      query = query.or('is_local.eq.true,name.ilike.ollama');
    }

    const { data, error } = (await query) as QueryResult<unknown>;

    if (error) {
      throw new HttpException(
        `Failed to fetch providers: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return ((data || []) as Array<Record<string, unknown>>).map(
      mapLLMProviderFromDb,
    );
  }

  async findOne(id: string): Promise<ProviderResponseDto | null> {
    const { data, error } = (await this.db
      .from(null, getTableName('llm_providers'))
      .select('*')
      .eq('id', id)
      .single()) as { data: unknown; error: unknown };

    if (error) {
      const err = error as Record<string, unknown>;
      if (err.code === 'PGRST116') {
        return null; // Not found
      }
      throw new HttpException(
        `Failed to fetch provider: ${String(err.message)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return data ? mapLLMProviderFromDb(data as Record<string, unknown>) : null;
  }

  async findModelsByProvider(
    providerId: string,
    status?: ModelStatus,
  ): Promise<ModelResponseDto[]> {
    let query = this.db
      .from(null, getTableName('llm_models'))
      .select(
        `
        *,
        provider:llm_providers(*)
      `,
      )
      .eq('provider_id', providerId)
      .order('display_name');

    // Default to showing only active models unless explicitly requesting inactive/deprecated
    if (status) {
      const isActive = status === 'active';
      query = query.eq('is_active', isActive);
    } else {
      // No status filter provided - default to active models only
      query = query.eq('is_active', true);
    }

    const { data, error } = (await query) as QueryResult<unknown>;

    if (error) {
      throw new HttpException(
        `Failed to fetch models: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return ((data || []) as Array<Record<string, unknown>>).map(
      mapLLMModelFromDb,
    );
  }

  async create(
    createProviderDto: CreateProviderDto,
  ): Promise<ProviderResponseDto> {
    // Check if provider name already exists
    const { data: existingProvider } = (await this.db
      .from(null, getTableName('llm_providers'))
      .select('id')
      .eq('name', createProviderDto.name)
      .single()) as QueryResult<unknown>;

    if (existingProvider) {
      throw new HttpException(
        'Provider name already exists',
        HttpStatus.CONFLICT,
      );
    }

    const dbPayload = {
      name: createProviderDto.name,
      api_base_url: createProviderDto.apiBaseUrl,
      auth_type: createProviderDto.authType,
      status: createProviderDto.status || 'active',
      is_local: createProviderDto.isLocal || false,
    };

    const { data, error } = (await this.db
      .from(null, getTableName('llm_providers'))
      .insert(dbPayload)
      .select()
      .single()) as { data: unknown; error: unknown };

    if (error) {
      const err = error as Record<string, unknown>;
      throw new HttpException(
        `Failed to create provider: ${String(err.message)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return mapLLMProviderFromDb(data as Record<string, unknown>);
  }

  async update(
    id: string,
    updateProviderDto: UpdateProviderDto,
  ): Promise<ProviderResponseDto | null> {
    // Check if provider exists
    const existing = await this.findOne(id);
    if (!existing) {
      return null;
    }

    // If updating name, check for conflicts
    if (updateProviderDto.name && updateProviderDto.name !== existing.name) {
      const { data: existingProvider } = (await this.db
        .from(null, getTableName('llm_providers'))
        .select('id')
        .eq('name', updateProviderDto.name)
        .neq('id', id)
        .single()) as QueryResult<unknown>;

      if (existingProvider) {
        throw new HttpException(
          'Provider name already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    // Convert camelCase DTO to snake_case for database
    const dbPayload: Record<string, unknown> = {};
    if (updateProviderDto.name !== undefined)
      dbPayload.name = updateProviderDto.name;
    if (updateProviderDto.apiBaseUrl !== undefined)
      dbPayload.api_base_url = updateProviderDto.apiBaseUrl;
    if (updateProviderDto.authType !== undefined)
      dbPayload.auth_type = updateProviderDto.authType;
    if (updateProviderDto.status !== undefined)
      dbPayload.status = updateProviderDto.status;
    if (updateProviderDto.isLocal !== undefined)
      dbPayload.is_local = updateProviderDto.isLocal;
    dbPayload.updated_at = new Date().toISOString();

    const { data, error } = (await this.db
      .from(null, getTableName('llm_providers'))
      .update(dbPayload)
      .eq('id', id)
      .select()
      .single()) as { data: unknown; error: unknown };

    if (error) {
      const err = error as Record<string, unknown>;
      throw new HttpException(
        `Failed to update provider: ${String(err.message)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return mapLLMProviderFromDb(data as Record<string, unknown>);
  }

  async delete(id: string): Promise<boolean> {
    // Check if provider exists
    const existing = await this.findOne(id);
    if (!existing) {
      return false;
    }

    // Check if provider has any models
    const { data: models } = (await this.db
      .from(null, getTableName('llm_models'))
      .select('id')
      .eq('provider_id', id)
      .limit(1)) as QueryResult<unknown>;

    const typedModels = models as Array<{ id: string }> | null;
    if (typedModels && typedModels.length > 0) {
      throw new HttpException(
        'Cannot delete provider with existing models',
        HttpStatus.CONFLICT,
      );
    }

    const { error } = (await this.db
      .from(null, getTableName('llm_providers'))
      .delete()
      .eq('id', id)) as QueryResult<unknown>;

    if (error) {
      throw new HttpException(
        `Failed to delete provider: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return true;
  }

  // Helper method to get provider by name
  async findByName(name: string): Promise<ProviderResponseDto | null> {
    const { data, error } = (await this.db
      .from(null, getTableName('llm_providers'))
      .select('*')
      .eq('name', name)
      .single()) as { data: unknown; error: unknown };

    if (error) {
      const err = error as Record<string, unknown>;
      if (err.code === 'PGRST116') {
        return null; // Not found
      }
      throw new HttpException(
        `Failed to fetch provider: ${String(err.message)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return data ? mapLLMProviderFromDb(data as Record<string, unknown>) : null;
  }
}
