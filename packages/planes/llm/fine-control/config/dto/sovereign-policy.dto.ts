import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SovereignModeType {
  STRICT = 'strict',
  RELAXED = 'relaxed',
}

export enum AuditLevel {
  NONE = 'none',
  BASIC = 'basic',
  FULL = 'full',
}

export class SovereignPolicyDto {
  @ApiProperty({
    description: 'Whether sovereign mode is enforced organization-wide',
    example: false,
  })
  enforced!: boolean;

  @ApiProperty({
    description: 'Default sovereign mode for new users',
    enum: SovereignModeType,
    example: SovereignModeType.RELAXED,
  })
  defaultMode!: SovereignModeType;

  @ApiProperty({
    description: 'Audit logging level for sovereign mode compliance',
    enum: AuditLevel,
    example: AuditLevel.BASIC,
  })
  auditLevel!: AuditLevel;

  @ApiProperty({
    description: 'Enable real-time policy change propagation',
    example: true,
  })
  realtimeUpdates!: boolean;
}

export class SovereignPolicyStatusDto {
  @ApiProperty({
    description: 'Whether sovereign mode is enforced organization-wide',
    example: false,
  })
  enforced!: boolean;

  @ApiProperty({
    description: 'Default sovereign mode for new users',
    example: 'relaxed',
  })
  defaultMode!: string;

  @ApiProperty({
    description: 'List of providers allowed in sovereign mode',
    example: ['ollama'],
    type: [String],
  })
  allowedProviders!: string[];

  @ApiPropertyOptional({
    description:
      'Fallback behavior when no compliant providers available (deprecated)',
    example: 'prompt_user',
    deprecated: true,
  })
  fallbackBehavior?: string;
}

export class ModelProviderDto {
  @ApiProperty({
    description: 'Provider name',
    example: 'ollama',
  })
  provider!: string;

  @ApiProperty({
    description: 'Model name',
    example: 'llama3.2:latest',
  })
  model!: string;

  @ApiProperty({
    description: 'Whether this is a local model',
    example: true,
  })
  isLocal!: boolean;

  @ApiProperty({
    description: 'Whether this model is compliant with sovereign mode',
    example: true,
  })
  sovereignCompliant!: boolean;

  @ApiProperty({
    description: 'Model tier/category',
    example: 'local-advanced',
  })
  modelTier!: string;

  @ApiPropertyOptional({
    description: 'Additional model metadata',
    example: { memoryRequirement: '8GB', contextWindow: 4096 },
  })
  metadata?: Record<string, unknown>;
}

export class ModelListResponseDto {
  @ApiProperty({
    description: 'List of available models/providers',
    type: [ModelProviderDto],
  })
  models!: ModelProviderDto[];

  @ApiProperty({
    description: 'Whether results are filtered for sovereign mode',
    example: true,
  })
  sovereignFiltered!: boolean;

  @ApiProperty({
    description: 'Total number of models before filtering',
    example: 15,
  })
  totalModels!: number;

  @ApiProperty({
    description: 'Number of sovereign-compliant models',
    example: 3,
  })
  sovereignCompliantModels!: number;
}

export class PolicyValidationResponseDto {
  @ApiProperty({
    description: 'Whether the policy configuration is valid',
    example: true,
  })
  valid!: boolean;

  @ApiProperty({
    description:
      'Effective sovereign mode status after applying precedence rules',
    example: true,
  })
  effectiveSovereignMode!: boolean;

  @ApiProperty({
    description: 'Validation warnings (non-blocking issues)',
    example: ['Sovereign mode enforced but default mode is relaxed'],
    type: [String],
  })
  warnings!: string[];

  @ApiProperty({
    description: 'Validation errors (blocking issues)',
    example: [],
    type: [String],
  })
  errors!: string[];

  @ApiPropertyOptional({
    description: 'Explanation of how precedence rules were applied',
    example: 'Organization enforcement takes precedence over user preference',
  })
  precedenceExplanation?: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
  })
  statusCode!: number;

  @ApiProperty({
    description: 'Error message',
    example: 'Invalid policy configuration',
  })
  message!: string;

  @ApiPropertyOptional({
    description: 'Detailed error information',
    example: 'enforced field must be a boolean',
  })
  error?: string;

  @ApiProperty({
    description: 'Timestamp of the error',
    example: '2024-01-15T10:30:00.000Z',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'API endpoint path',
    example: '/api/sovereign-policy/validate',
  })
  path!: string;
}
