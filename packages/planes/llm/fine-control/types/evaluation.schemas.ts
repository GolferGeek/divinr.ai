import { z } from 'zod';
import type { EnhancedMessageResponseDto } from '../dto/llm-evaluation.dto';
import type {
  EvaluationAggregationRow,
  EvaluationStatsRow,
  ModelComparisonMessageRow,
  TaskRecord,
} from '../types/evaluation.types';

const baseEnhancedMessageSchema = z
  .object({
    id: z.string().optional(),
  })
  .passthrough();

export const enhancedMessageResponseSchema =
  baseEnhancedMessageSchema as unknown as z.ZodType<EnhancedMessageResponseDto>;

export const enhancedMessageResponseArraySchema = z.array(
  enhancedMessageResponseSchema,
);

const aggregationBaseSchema = z
  .object({
    provider_name: z.string().nullable().optional(),
    model_name: z.string().nullable().optional(),
    total_reviews: z.number().optional(),
    average_rating: z.number().optional(),
    average_speed_rating: z.number().nullable().optional(),
    average_accuracy_rating: z.number().nullable().optional(),
  })
  .passthrough();

export const evaluationAggregationRowSchema =
  aggregationBaseSchema as unknown as z.ZodType<EvaluationAggregationRow>;

export const evaluationAggregationRowsSchema = z.array(
  evaluationAggregationRowSchema,
);

const evaluationStatsRowBaseSchema = z
  .object({
    user_rating: z.number().nullable().optional(),
    speed_rating: z.number().nullable().optional(),
    accuracy_rating: z.number().nullable().optional(),
    provider_id: z.string().nullable().optional(),
    model_id: z.string().nullable().optional(),
    model: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        model_name: z.string().optional(),
        modelId: z.string().optional(),
        modelName: z.string().optional(),
      })
      .nullable()
      .optional(),
    timestamp: z.string().nullable().optional(),
  })
  .passthrough();

export const evaluationStatsRowSchema =
  evaluationStatsRowBaseSchema as unknown as z.ZodType<EvaluationStatsRow>;

export const evaluationStatsRowsSchema = z.array(evaluationStatsRowSchema);

const modelComparisonRowBaseSchema = z
  .object({
    user_rating: z.number().nullable().optional(),
    speed_rating: z.number().nullable().optional(),
    accuracy_rating: z.number().nullable().optional(),
    response_time_ms: z.number().nullable().optional(),
    total_cost: z.number().nullable().optional(),
    model: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        model_name: z.string().optional(),
        modelId: z.string().optional(),
        modelName: z.string().optional(),
      })
      .nullable()
      .optional(),
    timestamp: z.string().nullable().optional(),
  })
  .passthrough();

export const modelComparisonRowSchema =
  modelComparisonRowBaseSchema as unknown as z.ZodType<ModelComparisonMessageRow>;

export const modelComparisonRowsSchema = z.array(modelComparisonRowSchema);

const workflowStepRecordSchema = z
  .object({
    status: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
  })
  .passthrough();

const taskEvaluationRecordSchema = z
  .object({
    user_rating: z.number().nullable().optional(),
    speed_rating: z.number().nullable().optional(),
    accuracy_rating: z.number().nullable().optional(),
    user_notes: z.string().nullable().optional(),
    evaluation_timestamp: z.string().nullable().optional(),
    evaluation_details: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();

const taskResponseMetadataSchema = z
  .object({
    agent_name: z.string().nullable().optional(),
    agentName: z.string().nullable().optional(),
    workflow_steps_completed: z
      .array(workflowStepRecordSchema)
      .nullable()
      .optional(),
    content: z.any().optional(),
    response: z.any().optional(),
  })
  .catchall(z.unknown())
  .nullable()
  .optional();

const taskLLMMetadataSchema = z
  .object({
    response_time_ms: z.number().nullable().optional(),
    total_cost: z.number().nullable().optional(),
    originalLLMSelection: z
      .object({
        providerId: z.string().nullable().optional(),
        modelId: z.string().nullable().optional(),
        cidafmOptions: z.record(z.unknown()).nullable().optional(),
      })
      .nullable()
      .optional(),
    agent_name: z.string().nullable().optional(),
    agentName: z.string().nullable().optional(),
  })
  .catchall(z.unknown())
  .nullable()
  .optional();

export const taskRecordSchema = z
  .object({
    id: z.string(),
    prompt: z.string().nullable().optional(),
    response: z.string().nullable().optional(),
    method: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    conversation_id: z.string().nullable().optional(),
    session_id: z.string().nullable().optional(),
    user_id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    progress_message: z.string().nullable().optional(),
    deliverable_metadata: z.record(z.unknown()).nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    response_metadata: taskResponseMetadataSchema,
    llm_metadata: taskLLMMetadataSchema,
    evaluation: taskEvaluationRecordSchema.nullable().optional(),
  })
  .passthrough();

export const taskRecordArraySchema = z.array(
  taskRecordSchema as unknown as z.ZodType<TaskRecord>,
);
