import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  IsNumber,
  IsEnum,
  IsDate,
  IsBoolean,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * User information for evaluation context
 */
export class EvaluationUserDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name!: string;

  @ApiProperty({
    example: ['user', 'evaluation-monitor'],
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  roles!: string[];
}

/**
 * Workflow step details for evaluation metadata
 */
export class WorkflowStepDto {
  @ApiProperty({ example: 'data_preparation' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'completed',
    enum: ['pending', 'in_progress', 'completed', 'failed'],
  })
  @IsEnum(['pending', 'in_progress', 'completed', 'failed'])
  status!: 'pending' | 'in_progress' | 'completed' | 'failed';

  @ApiPropertyOptional({
    example: 1500,
    description: 'Duration in milliseconds',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  duration?: number;

  @ApiPropertyOptional({ example: 'Connection timeout to external API' })
  @IsString()
  @IsOptional()
  error?: string;

  @ApiPropertyOptional({ description: 'Additional step metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  startTime?: Date;

  @ApiPropertyOptional()
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  endTime?: Date;
}

/**
 * Workflow tracking information for evaluations
 */
export class WorkflowTrackingDto {
  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  totalSteps!: number;

  @ApiProperty({ example: 4 })
  @IsNumber()
  @Min(0)
  completedSteps!: number;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0)
  failedSteps!: number;

  @ApiProperty({ example: 80, description: 'Completion percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  progressPercent!: number;

  @ApiProperty({
    type: [WorkflowStepDto],
    description: 'Detailed information about each workflow step',
  })
  @IsArray()
  @Type(() => WorkflowStepDto)
  stepDetails!: WorkflowStepDto[];

  @ApiPropertyOptional({
    example: 5000,
    description: 'Total workflow duration in milliseconds',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  totalDuration?: number;

  @ApiPropertyOptional({
    example: 'data_preparation',
    description: 'Name of the step that failed',
  })
  @IsString()
  @IsOptional()
  failedStep?: string;
}

/**
 * CIDAFM constraint effectiveness tracking
 */
export class ConstraintEffectivenessDto {
  @ApiProperty({
    example: 4,
    description: 'How well modifiers were followed (1-5 scale)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  modifierCompliance!: number;

  @ApiProperty({
    example: 'Response was appropriately concise and technical as requested',
    description: 'Description of how constraints impacted the response',
  })
  @IsString()
  constraintImpact!: string;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Overall effectiveness rating of applied constraints (1-5 scale)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  overallEffectiveness?: number;
}

/**
 * Enhanced CIDAFM constraint data (renamed from "Sadafim")
 */
export class LLMConstraintsDto {
  @ApiProperty({
    example: ['disciplined', 'concise'],
    description: 'Active state modifiers that persist across responses',
  })
  @IsArray()
  @IsString({ each: true })
  activeStateModifiers!: string[];

  @ApiProperty({
    example: ['technical', 'brief'],
    description: 'Response modifiers applied to current response only',
  })
  @IsArray()
  @IsString({ each: true })
  responseModifiers!: string[];

  @ApiProperty({
    example: ['state-check', 'export-context'],
    description: 'Execution commands that were processed',
  })
  @IsArray()
  @IsString({ each: true })
  executedCommands!: string[];

  @ApiPropertyOptional({
    type: ConstraintEffectivenessDto,
    description: 'Analysis of how well constraints were followed',
  })
  @IsOptional()
  @Type(() => ConstraintEffectivenessDto)
  constraintEffectiveness?: ConstraintEffectivenessDto;

  @ApiPropertyOptional({
    description: 'Additional constraint processing metadata',
  })
  @IsObject()
  @IsOptional()
  processingNotes?: Record<string, unknown>;
}

/**
 * Enhanced LLM information with detailed metrics
 */
export class EnhancedLLMInfoDto {
  @ApiProperty({ example: 'OpenAI' })
  @IsString()
  provider!: string;

  @ApiProperty({ example: 'gpt-4' })
  @IsString()
  model!: string;

  @ApiProperty({ example: 1500, description: 'Response time in milliseconds' })
  @IsNumber()
  @Min(0)
  responseTimeMs!: number;

  @ApiProperty({ example: 0.0012, description: 'Cost in USD' })
  @IsNumber()
  @Min(0)
  cost!: number;

  @ApiProperty({
    description: 'Token usage details',
    example: { input: 150, output: 75 },
  })
  @IsObject()
  tokenUsage!: {
    input: number;
    output: number;
  };

  @ApiPropertyOptional({
    example: 'gpt-4-0613',
    description: 'Specific model version',
  })
  @IsString()
  @IsOptional()
  modelVersion?: string;

  @ApiPropertyOptional({
    example: 0.8,
    description: 'Temperature setting used',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ example: 2048, description: 'Max tokens setting' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  maxTokens?: number;
}

export class AgentLLMRecommendationDto {
  @ApiPropertyOptional({ description: 'LLM provider UUID' })
  @IsUUID()
  @IsOptional()
  providerId?: string;

  @ApiProperty({ description: 'LLM provider display name', example: 'OpenAI' })
  @IsString()
  providerName!: string;

  @ApiPropertyOptional({ description: 'LLM model UUID' })
  @IsUUID()
  @IsOptional()
  modelId?: string;

  @ApiProperty({ description: 'LLM model name', example: 'gpt-4o-mini' })
  @IsString()
  modelName!: string;

  @ApiProperty({
    description: 'Average overall user rating (1-5)',
    example: 4.7,
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  averageRating!: number;

  @ApiProperty({
    description: 'Number of evaluations contributing to the score',
    example: 12,
  })
  @IsNumber()
  @Min(1)
  evaluationCount!: number;

  @ApiPropertyOptional({
    description: 'Latest evaluation timestamp included in this aggregate',
    example: '2024-09-15T18:23:11.123Z',
  })
  @IsOptional()
  @IsString()
  lastEvaluatedAt?: string;
}

/**
 * Task information for evaluation context
 */
export class EvaluationTaskDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id!: string;

  @ApiProperty({
    example: 'Please analyze the quarterly sales data and provide insights',
  })
  @IsString()
  prompt!: string;

  @ApiPropertyOptional({
    example: 'The analysis shows a 15% increase in Q3 sales...',
  })
  @IsString()
  @IsOptional()
  response?: string;

  @ApiProperty({ example: 'Data Analysis Agent' })
  @IsString()
  agentName!: string;

  @ApiProperty({ example: 'analyze_data' })
  @IsString()
  method!: string;

  @ApiProperty({
    example: 'completed',
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
  })
  @IsEnum(['pending', 'running', 'completed', 'failed', 'cancelled'])
  status!: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  createdAt!: Date;

  @ApiPropertyOptional()
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  completedAt?: Date;

  @ApiPropertyOptional({
    example: 85,
    description: 'Task completion progress percentage',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress?: number;

  @ApiPropertyOptional({ description: 'Additional task metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * Core evaluation data
 */
export class EvaluationDataDto {
  @ApiProperty({
    example: 4,
    description: 'Overall user rating (1-5 scale)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  userRating!: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Speed/performance rating (1-5 scale)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  speedRating?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Accuracy/quality rating (1-5 scale)',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  accuracyRating?: number;

  @ApiPropertyOptional({
    example: 'Great analysis, very thorough and actionable insights',
  })
  @IsString()
  @IsOptional()
  userNotes?: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  evaluationTimestamp!: Date;

  @ApiPropertyOptional({ description: 'Additional evaluation details' })
  @IsObject()
  @IsOptional()
  evaluationDetails?: Record<string, unknown>;
}

/**
 * Complete enhanced evaluation metadata
 */
export class EnhancedEvaluationMetadataDto {
  @ApiProperty({
    type: EvaluationUserDto,
    description: 'User who performed the evaluation',
  })
  @Type(() => EvaluationUserDto)
  user!: EvaluationUserDto;

  @ApiProperty({
    type: EvaluationDataDto,
    description: 'Core evaluation ratings and feedback',
  })
  @Type(() => EvaluationDataDto)
  evaluation!: EvaluationDataDto;

  @ApiProperty({
    type: EvaluationTaskDto,
    description: 'Task that was evaluated',
  })
  @Type(() => EvaluationTaskDto)
  task!: EvaluationTaskDto;

  @ApiPropertyOptional({
    type: WorkflowTrackingDto,
    description: 'Workflow step tracking information',
  })
  @Type(() => WorkflowTrackingDto)
  @IsOptional()
  workflowSteps?: WorkflowTrackingDto;

  @ApiPropertyOptional({
    type: LLMConstraintsDto,
    description: 'CIDAFM constraint data and effectiveness',
  })
  @Type(() => LLMConstraintsDto)
  @IsOptional()
  llmConstraints?: LLMConstraintsDto;

  @ApiProperty({
    type: EnhancedLLMInfoDto,
    description: 'LLM provider and performance information',
  })
  @Type(() => EnhancedLLMInfoDto)
  llmInfo!: EnhancedLLMInfoDto;

  @ApiPropertyOptional({ description: 'Additional system metadata' })
  @IsObject()
  @IsOptional()
  systemMetadata?: Record<string, unknown>;
}

/**
 * Admin evaluation query filters
 */
export class AdminEvaluationFiltersDto {
  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, maximum: 100 })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  @Type(() => Number)
  minRating?: number;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  @Type(() => Number)
  maxRating?: number;

  @ApiPropertyOptional({ example: 'Data Analysis Agent' })
  @IsString()
  @IsOptional()
  agentName?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsEmail()
  @IsOptional()
  userEmail?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  hasNotes?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  hasWorkflowSteps?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  hasConstraints?: boolean;

  @ApiPropertyOptional({ example: 'failed' })
  @IsString()
  @IsOptional()
  workflowStepStatus?: string;

  @ApiPropertyOptional({ example: 'disciplined' })
  @IsString()
  @IsOptional()
  constraintType?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  minResponseTime?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  maxResponseTime?: number;

  @ApiPropertyOptional({ example: 'OpenAI' })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ example: 'gpt-4' })
  @IsString()
  @IsOptional()
  model?: string;
}

/**
 * Admin evaluation analytics response
 */
export class EvaluationAnalyticsDto {
  @ApiProperty({ example: 150 })
  @IsNumber()
  totalEvaluations!: number;

  @ApiProperty({ example: 4.2 })
  @IsNumber()
  averageRating!: number;

  @ApiProperty({ example: 3.8 })
  @IsNumber()
  averageSpeedRating!: number;

  @ApiProperty({ example: 4.5 })
  @IsNumber()
  averageAccuracyRating!: number;

  @ApiProperty({ example: 85.5 })
  @IsNumber()
  averageWorkflowCompletionRate!: number;

  @ApiProperty({ example: 1250 })
  @IsNumber()
  averageResponseTime!: number;

  @ApiProperty({ example: 0.0035 })
  @IsNumber()
  averageCost!: number;

  @ApiProperty({ description: 'Rating distribution by score' })
  @IsObject()
  ratingDistribution!: Record<string, number>;

  @ApiProperty({ description: 'Top performing agents' })
  @IsArray()
  topPerformingAgents!: Array<{
    agentName: string;
    averageRating: number;
    evaluationCount: number;
  }>;

  @ApiProperty({ description: 'Most effective constraints' })
  @IsArray()
  topConstraints!: Array<{
    constraintName: string;
    effectivenessScore: number;
    usageCount: number;
  }>;

  @ApiProperty({ description: 'Common workflow failure points' })
  @IsArray()
  workflowFailurePoints!: Array<{
    stepName: string;
    failureRate: number;
    averageDuration: number;
  }>;
}
