import type { UserRatingScale } from '../types/llm-evaluation';

export interface EvaluationFilters {
  minRating?: number;
  hasNotes?: boolean;
}

export interface EvaluationStatsFilters {
  startDate?: string;
  endDate?: string;
  providerId?: string;
  modelId?: string;
}

export interface ModelComparisonFilters {
  startDate?: string;
  endDate?: string;
}

export interface FeedbackExportOptions {
  format: 'json' | 'csv';
  startDate?: string;
  endDate?: string;
  includeContent?: boolean;
}

export interface AllUserEvaluationsFilters {
  page: number;
  limit: number;
  minRating?: number;
  hasNotes?: boolean;
  agentName?: string;
}

export interface TaskEvaluationRecord {
  user_rating?: number | null;
  speed_rating?: number | null;
  accuracy_rating?: number | null;
  user_notes?: string | null;
  evaluation_timestamp?: string | null;
  evaluation_details?: Record<string, unknown> | null;
}

export interface WorkflowStepRecord {
  status?: string | null;
  name?: string | null;
  duration?: number | null;
}

export interface TaskResponseMetadata {
  agent_name?: string | null;
  agentName?: string | null;
  workflow_steps_completed?: WorkflowStepRecord[] | null;
  content?: string | null;
  response?: string | null;
  [key: string]: unknown;
}

export interface TaskLLMSelection {
  providerId?: string | null;
  modelId?: string | null;
  cidafmOptions?: {
    activeStateModifiers?: unknown[] | null;
    responseModifiers?: unknown[] | null;
    [key: string]: unknown;
  } | null;
}

export interface TaskLLMMetadata {
  response_time_ms?: number | null;
  total_cost?: number | null;
  originalLLMSelection?: TaskLLMSelection | null;
  agent_name?: string | null;
  agentName?: string | null;
  [key: string]: unknown;
}

export interface TaskRecord {
  id: string;
  prompt?: string | null;
  response?: string | null;
  method?: string | null;
  status?: string | null;
  conversation_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  type?: string | null;
  metadata?: Record<string, unknown> | null;
  response_metadata?: TaskResponseMetadata | null;
  llm_metadata?: TaskLLMMetadata | null;
  evaluation?: TaskEvaluationRecord | null;
}

export interface MessageRecord {
  id: string;
  user_rating?: number | null;
  evaluation_timestamp?: string | null;
  timestamp?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  provider?: {
    id: string;
    provider_name: string;
  } | null;
  model?: {
    id: string;
    model_name: string;
  } | null;
  [key: string]: unknown;
}

export interface UserProfileRecord {
  id: string;
  email?: string | null;
  display_name?: string | null;
  roles?: string[] | null;
}

export interface EvaluationRow {
  id: string;
  user_id: string;
  session_id: string | null;
  user_rating: UserRatingScale | null;
  speed_rating: UserRatingScale | null;
  accuracy_rating: UserRatingScale | null;
  user_notes: string | null;
  evaluation_details: Record<string, unknown> | null;
  evaluation_timestamp: string | null;
  provider?: {
    id: string;
    provider_name: string;
  } | null;
  model?: {
    id: string;
    model_name: string;
  } | null;
}

export interface EvaluationAggregationRow {
  provider_name: string | null;
  model_name: string | null;
  total_reviews: number;
  average_rating: number;
  average_speed_rating: number | null;
  average_accuracy_rating: number | null;
}

export interface EvaluationStatsRow {
  user_rating: number | null;
  speed_rating: number | null;
  accuracy_rating: number | null;
  provider_id: string | null;
  model_id: string | null;
  model?: {
    id?: string;
    name?: string;
    model_name?: string;
    modelId?: string;
    modelName?: string;
  } | null;
  timestamp?: string | null;
}

export interface ModelComparisonMessageRow {
  user_rating: number | null;
  speed_rating: number | null;
  accuracy_rating: number | null;
  response_time_ms: number | null;
  total_cost: number | null;
  model?: {
    id?: string;
    name?: string;
    model_name?: string;
    modelId?: string;
    modelName?: string;
  } | null;
  timestamp?: string | null;
}
