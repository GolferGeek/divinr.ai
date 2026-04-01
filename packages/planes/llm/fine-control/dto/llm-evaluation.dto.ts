// LLM Evaluation DTOs
// Data Transfer Objects for LLM evaluation API endpoints

import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsArray,
  IsObject,
  IsDateString,
  Min,
  Max,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ProviderStatus,
  ModelStatus,
  AuthType,
  CIDAFMCommandType,
  UserRatingScale,
} from '../types/llm-evaluation';

// ==================== Provider DTOs ====================

export class CreateProviderDto {
  @ApiProperty({ description: 'Provider name', example: 'OpenAI' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'API base URL',
    example: 'https://api.openai.com/v1',
  })
  @IsString()
  @IsOptional()
  apiBaseUrl?: string;

  @ApiProperty({
    enum: ['api_key', 'oauth', 'none'],
    description: 'Authentication type',
  })
  @IsEnum(['api_key', 'oauth', 'none'])
  authType!: AuthType;

  @ApiPropertyOptional({
    enum: ['active', 'inactive', 'deprecated'],
    default: 'active',
  })
  @IsEnum(['active', 'inactive', 'deprecated'])
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({
    description: 'Whether this provider runs locally (e.g., Ollama)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isLocal?: boolean;
}

export class UpdateProviderDto {
  @ApiPropertyOptional({ description: 'Provider name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'API base URL' })
  @IsString()
  @IsOptional()
  apiBaseUrl?: string;

  @ApiPropertyOptional({ enum: ['api_key', 'oauth', 'none'] })
  @IsEnum(['api_key', 'oauth', 'none'])
  @IsOptional()
  authType?: AuthType;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'deprecated'] })
  @IsEnum(['active', 'inactive', 'deprecated'])
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({
    description: 'Whether this provider runs locally (e.g., Ollama)',
  })
  @IsBoolean()
  @IsOptional()
  isLocal?: boolean;
}

export class ProviderResponseDto {
  @ApiProperty({ description: 'Provider name' })
  name!: string;

  @ApiPropertyOptional({ description: 'API base URL' })
  apiBaseUrl?: string;

  @ApiProperty({ enum: ['api_key', 'oauth', 'none'] })
  authType!: AuthType;

  @ApiProperty({ enum: ['active', 'inactive', 'deprecated'] })
  status!: ProviderStatus;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: string;

  @ApiPropertyOptional({
    description: 'Whether this provider runs locally (e.g., Ollama)',
  })
  isLocal?: boolean;
}

// ==================== Simple Name List DTOs ====================

export class ProviderNameDto {
  @ApiProperty({ description: 'Provider name', example: 'openai' })
  name!: string;
}

export class ModelNameDto {
  @ApiProperty({ description: 'Provider name', example: 'openai' })
  providerName!: string;

  @ApiProperty({
    description: 'Model name for API calls',
    example: 'gpt-4o-mini',
  })
  modelName!: string;

  @ApiProperty({
    description: 'Human-readable display name',
    example: 'GPT-4o Mini',
  })
  displayName!: string;

  @ApiPropertyOptional({ description: 'Whether the model is active' })
  is_active?: boolean;

  @ApiPropertyOptional({
    description: 'Model tier (flagship, premium, standard, economy)',
  })
  model_tier?: string;

  @ApiPropertyOptional({ description: 'Context window size in tokens' })
  context_window?: number;
}

export class ProviderWithModelsDto {
  @ApiProperty({ description: 'Provider ID' })
  id!: string;

  @ApiProperty({ description: 'Provider name', example: 'openai' })
  name!: string;

  @ApiPropertyOptional({ description: 'Display name' })
  display_name?: string;

  @ApiPropertyOptional({
    description: 'Whether this provider runs locally (e.g., Ollama)',
  })
  is_local?: boolean;

  @ApiPropertyOptional({ description: 'Whether the provider is active' })
  is_active?: boolean;

  @ApiProperty({ description: 'Available models', type: [ModelNameDto] })
  models!: ModelNameDto[];
}

// ==================== Model DTOs ====================

export class CreateModelDto {
  @ApiProperty({ description: 'Provider name' })
  @IsString()
  @IsNotEmpty()
  providerName!: string;

  @ApiProperty({ description: 'Human-readable model name', example: 'GPT-4o' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Model name for API calls', example: 'gpt-4o' })
  @IsString()
  @IsNotEmpty()
  modelName!: string;

  @ApiPropertyOptional({
    description: 'Input pricing per 1K tokens (USD)',
    example: 0.0025,
  })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  pricingInputPer1k?: number;

  @ApiPropertyOptional({
    description: 'Output pricing per 1K tokens (USD)',
    example: 0.01,
  })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  pricingOutputPer1k?: number;

  @ApiPropertyOptional({
    description: 'Supports thinking mode',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  supportsThinking?: boolean;

  @ApiPropertyOptional({ description: 'Maximum output tokens', example: 4096 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'Context window size', example: 128000 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  contextWindow?: number;

  @ApiPropertyOptional({ description: 'Model strengths', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  strengths?: string[];

  @ApiPropertyOptional({ description: 'Model weaknesses', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  weaknesses?: string[];

  @ApiPropertyOptional({ description: 'Recommended use cases', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  useCases?: string[];

  @ApiPropertyOptional({
    enum: ['active', 'inactive', 'deprecated'],
    default: 'active',
  })
  @IsEnum(['active', 'inactive', 'deprecated'])
  @IsOptional()
  status?: ModelStatus;
}

export class UpdateModelDto {
  @ApiPropertyOptional({ description: 'Human-readable model name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Model name for API calls' })
  @IsString()
  @IsOptional()
  modelName?: string;

  @ApiPropertyOptional({ description: 'Input pricing per 1K tokens (USD)' })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  pricingInputPer1k?: number;

  @ApiPropertyOptional({ description: 'Output pricing per 1K tokens (USD)' })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @IsOptional()
  pricingOutputPer1k?: number;

  @ApiPropertyOptional({ description: 'Supports thinking mode' })
  @IsBoolean()
  @IsOptional()
  supportsThinking?: boolean;

  @ApiPropertyOptional({ description: 'Maximum output tokens' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'Context window size' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  contextWindow?: number;

  @ApiPropertyOptional({ description: 'Model strengths', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  strengths?: string[];

  @ApiPropertyOptional({ description: 'Model weaknesses', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  weaknesses?: string[];

  @ApiPropertyOptional({ description: 'Recommended use cases', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  useCases?: string[];

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'deprecated'] })
  @IsEnum(['active', 'inactive', 'deprecated'])
  @IsOptional()
  status?: ModelStatus;
}

export class ModelResponseDto {
  @ApiProperty({ description: 'Provider name' })
  providerName!: string;

  @ApiProperty({ description: 'Human-readable model name' })
  name!: string;

  @ApiProperty({ description: 'Model name for API calls' })
  modelName!: string;

  @ApiPropertyOptional({ description: 'Input pricing per 1K tokens (USD)' })
  pricingInputPer1k?: number;

  @ApiPropertyOptional({ description: 'Output pricing per 1K tokens (USD)' })
  pricingOutputPer1k?: number;

  @ApiProperty({ description: 'Supports thinking mode' })
  supportsThinking!: boolean;

  @ApiPropertyOptional({ description: 'Maximum output tokens' })
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'Context window size' })
  contextWindow?: number;

  @ApiPropertyOptional({ description: 'Model strengths', type: [String] })
  strengths?: string[];

  @ApiPropertyOptional({ description: 'Model weaknesses', type: [String] })
  weaknesses?: string[];

  @ApiPropertyOptional({ description: 'Recommended use cases', type: [String] })
  useCases?: string[];

  @ApiProperty({ enum: ['active', 'inactive', 'deprecated'] })
  status!: ModelStatus;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: string;

  @ApiPropertyOptional({ description: 'Provider details (when joined)' })
  provider?: ProviderResponseDto;
}

// ==================== CIDAFM Command DTOs ====================

export class CreateCIDAFMCommandDto {
  @ApiProperty({
    enum: ['^', '&', '!'],
    description: 'Command type: ^ (response), & (state), ! (execution)',
  })
  @IsEnum(['^', '&', '!'])
  type!: CIDAFMCommandType;

  @ApiProperty({
    description: 'Command name (without type prefix)',
    example: 'concise',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Command description' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class CIDAFMCommandResponseDto {
  @ApiProperty({ description: 'Command UUID' })
  id!: string;

  @ApiProperty({ enum: ['^', '&', '!'] })
  type!: CIDAFMCommandType;

  @ApiProperty({ description: 'Command name' })
  name!: string;

  @ApiPropertyOptional({ description: 'Command description' })
  description?: string;

  @ApiProperty({ description: 'Whether command is active by default' })
  defaultActive!: boolean;

  @ApiProperty({ description: 'Whether this is a built-in command' })
  isBuiltin!: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: string;
}

// ==================== Message Enhancement DTOs ====================

export class LLMSelectionDto {
  @ApiProperty({ description: 'Provider name' })
  @IsString()
  @IsNotEmpty()
  providerName!: string;

  @ApiProperty({ description: 'Model name' })
  @IsString()
  @IsNotEmpty()
  modelName!: string;

  @ApiPropertyOptional({ description: 'CIDAFM options', type: Object })
  @IsObject()
  @IsOptional()
  cidafmOptions?: {
    activeStateModifiers?: string[];
    responseModifiers?: string[];
    executedCommands?: string[];
    customOptions?: Record<string, unknown>;
  };
}

export class MessageEvaluationDto {
  @ApiPropertyOptional({
    description: 'Overall rating (1-5)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  userRating?: UserRatingScale;

  @ApiPropertyOptional({
    description: 'Speed rating (1-5)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  speedRating?: UserRatingScale;

  @ApiPropertyOptional({
    description: 'Accuracy rating (1-5)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  accuracyRating?: UserRatingScale;

  @ApiPropertyOptional({ description: 'User notes and feedback' })
  @IsString()
  @IsOptional()
  userNotes?: string;

  @ApiPropertyOptional({
    description: 'Additional evaluation details',
    type: Object,
  })
  @IsObject()
  @IsOptional()
  evaluationDetails?: {
    additionalMetrics?: Record<string, number>;
    tags?: string[];
    feedback?: string;
    userContext?: string;
    modelConfidence?: number;
  };
}

export class EnhancedMessageCreateDto {
  @ApiProperty({ description: 'Message content' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({ description: 'LLM selection for this message' })
  @ValidateNested()
  @Type(() => LLMSelectionDto)
  @IsOptional()
  llmSelection?: LLMSelectionDto;
}

export class EnhancedMessageResponseDto {
  @ApiProperty({ description: 'Message UUID' })
  id!: string;

  @ApiProperty({ description: 'Session UUID' })
  sessionId!: string;

  @ApiProperty({ description: 'User UUID' })
  userId!: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system', 'tool'] })
  role!: 'user' | 'assistant' | 'system' | 'tool';

  @ApiPropertyOptional({ description: 'Message content' })
  content?: string;

  @ApiProperty({ description: 'Message timestamp' })
  timestamp!: string;

  @ApiProperty({ description: 'Message order in session' })
  order!: number;

  @ApiPropertyOptional({ description: 'Message metadata' })
  metadata?: Record<string, unknown>;

  // LLM fields
  @ApiPropertyOptional({ description: 'Provider name' })
  providerName?: string;

  @ApiPropertyOptional({ description: 'Model name' })
  modelName?: string;

  @ApiPropertyOptional({ description: 'Input tokens consumed' })
  inputTokens?: number;

  @ApiPropertyOptional({ description: 'Output tokens generated' })
  outputTokens?: number;

  @ApiPropertyOptional({ description: 'Total cost in USD' })
  totalCost?: number;

  @ApiPropertyOptional({ description: 'Response time in milliseconds' })
  responseTimeMs?: number;

  @ApiPropertyOptional({ description: 'LangSmith run ID' })
  langsmithRunId?: string;

  // Evaluation fields
  @ApiPropertyOptional({ description: 'Overall rating (1-5)' })
  userRating?: UserRatingScale;

  @ApiPropertyOptional({ description: 'Speed rating (1-5)' })
  speedRating?: UserRatingScale;

  @ApiPropertyOptional({ description: 'Accuracy rating (1-5)' })
  accuracyRating?: UserRatingScale;

  @ApiPropertyOptional({ description: 'User notes' })
  userNotes?: string;

  @ApiPropertyOptional({ description: 'Evaluation timestamp' })
  evaluationTimestamp?: string;

  @ApiPropertyOptional({ description: 'CIDAFM options used' })
  cidafmOptions?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Additional evaluation details' })
  evaluationDetails?: Record<string, unknown>;

  // Joined data
  @ApiPropertyOptional({ description: 'Provider details (when joined)' })
  provider?: ProviderResponseDto;

  @ApiPropertyOptional({ description: 'Model details (when joined)' })
  model?: ModelResponseDto;
}

// ==================== Usage Stats DTOs ====================

export class UsageStatsQueryDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by provider name' })
  @IsString()
  @IsOptional()
  providerName?: string;

  @ApiPropertyOptional({ description: 'Filter by model name' })
  @IsString()
  @IsOptional()
  modelName?: string;

  @ApiPropertyOptional({
    description: 'Include detailed breakdown',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  includeDetails?: boolean;
}

export class UsageStatsResponseDto {
  @ApiProperty({ description: 'User UUID' })
  userId!: string;

  @ApiProperty({ description: 'Date range queried' })
  dateRange!: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({ description: 'Total requests made' })
  totalRequests!: number;

  @ApiProperty({ description: 'Total tokens consumed' })
  totalTokens!: number;

  @ApiProperty({ description: 'Total cost in USD' })
  totalCost!: number;

  @ApiProperty({ description: 'Average response time in ms' })
  averageResponseTime!: number;

  @ApiPropertyOptional({ description: 'Average user rating' })
  averageUserRating?: number;

  @ApiPropertyOptional({ description: 'Breakdown by provider', type: Array })
  byProvider?: Array<{
    provider: ProviderResponseDto;
    requests: number;
    tokens: number;
    cost: number;
    avgRating?: number;
  }>;

  @ApiPropertyOptional({ description: 'Breakdown by model', type: Array })
  byModel?: Array<{
    model: ModelResponseDto;
    requests: number;
    tokens: number;
    cost: number;
    avgRating?: number;
  }>;

  @ApiPropertyOptional({ description: 'Daily statistics', type: Array })
  dailyStats?: Array<{
    date: string;
    requests: number;
    tokens: number;
    cost: number;
    avgResponseTime?: number;
  }>;
}

// ==================== Cost Calculation DTOs ====================

export class CostEstimateDto {
  @ApiProperty({ description: 'Message content to estimate' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiProperty({ description: 'Model name for pricing' })
  @IsString()
  @IsNotEmpty()
  modelName!: string;

  @ApiPropertyOptional({
    description: 'Estimated response length factor',
    default: 1.0,
  })
  @IsNumber()
  @Min(0.1)
  @Max(10.0)
  @IsOptional()
  responseLengthFactor?: number;
}

export class CostEstimateResponseDto {
  @ApiProperty({ description: 'Estimated input tokens' })
  estimatedInputTokens!: number;

  @ApiProperty({ description: 'Estimated output tokens' })
  estimatedOutputTokens!: number;

  @ApiProperty({ description: 'Estimated total cost in USD' })
  estimatedCost!: number;

  @ApiPropertyOptional({ description: 'Cost warning if expensive' })
  maxCostWarning?: string;

  @ApiProperty({ description: 'Currency (USD)' })
  currency!: string;

  @ApiProperty({ description: 'Model used for estimation' })
  model!: ModelResponseDto;
}
