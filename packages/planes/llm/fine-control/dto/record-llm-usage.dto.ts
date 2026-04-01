import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsObject,
  Min,
} from 'class-validator';

/**
 * DTO for recording LLM usage from external callers (e.g., LangGraph tools)
 *
 * Used when tools call specialized LLMs directly (e.g., Ollama/SQLCoder)
 * rather than going through the central /llm/generate endpoint.
 */
export class RecordLLMUsageDto {
  @IsString()
  provider!: string;

  @IsString()
  model!: string;

  @IsNumber()
  @Min(0)
  promptTokens!: number;

  @IsNumber()
  @Min(0)
  completionTokens!: number;

  @IsNumber()
  @Min(0)
  totalTokens!: number;

  @IsString()
  userId!: string;

  @IsString()
  @IsIn(['langgraph-tool', 'langgraph-workflow', 'n8n', 'external'])
  callerType!: string;

  @IsString()
  callerName!: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  latencyMs?: number;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
