// LLM Evaluation Types
// TypeScript type definitions for LLM provider/model selection and evaluation features

// ==================== Core Enums and Types ====================

export type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cohere'
  | 'mistral'
  | 'ollama'
  | 'xai'
  | 'together'
  | 'groq';

export type ProviderStatus = 'active' | 'inactive' | 'deprecated';
export type ModelStatus = 'active' | 'inactive' | 'deprecated';
export type AuthType = 'api_key' | 'oauth' | 'none';

export type CIDAFMCommandType = '^' | '&' | '!';
export type CIDAFMTypeName =
  | 'Response Modifier'
  | 'State Modifier'
  | 'Execution Command';

export type UserRatingScale = 1 | 2 | 3 | 4 | 5;

// ==================== System Configuration Interfaces ====================

/**
 * System operation types that may need different LLM configurations
 */
export type SystemOperationType =
  | 'delegation' // Deciding which agent to delegate to
  | 'agent_selection' // Selecting best agent for task
  | 'response_coordination' // Coordinating/organizing responses
  | 'conversation_analysis' // Understanding conversation context
  | 'error_handling' // Fallback operations
  | 'default'; // Default system operations

/**
 * System LLM configuration for orchestrator internal operations
 * Optimized for fast, cost-effective decision making
 */
export interface SystemLLMConfig {
  /** Provider for system operations (e.g., 'openai') */
  provider: LLMProvider;
  /** Model for system operations (e.g., 'gpt-3.5-turbo') */
  model: string;
  /** Temperature for consistent decision making (typically low, e.g., 0.1) */
  temperature: number;
  /** Max tokens for system operations (typically low for efficiency) */
  maxTokens: number;
  /** Whether this config is enabled */
  enabled: boolean;
  /** Description of what this config is used for */
  description?: string;
}

/**
 * Collection of system LLM configurations for different operation types
 */
export interface SystemLLMConfigs {
  /** Configuration for delegation decisions */
  delegation: SystemLLMConfig;
  /** Configuration for agent selection logic */
  agent_selection: SystemLLMConfig;
  /** Configuration for response coordination */
  response_coordination: SystemLLMConfig;
  /** Configuration for conversation analysis */
  conversation_analysis: SystemLLMConfig;
  /** Configuration for error handling/fallback */
  error_handling: SystemLLMConfig;
  /** Default configuration for other system operations */
  default: SystemLLMConfig;
}

/**
 * User LLM preferences for content generation
 * User-configurable settings for their actual work
 */
export interface UserLLMPreferences {
  /** User's preferred provider name from database */
  providerName?: string;
  /** User's preferred model name from database */
  modelName?: string;
  /** User's preferred temperature setting */
  temperature?: number;
  /** User's preferred max tokens */
  maxTokens?: number;
  /** CIDAFM options for content modification */
  cidafmOptions?: CIDAFMOptions;
}

// ==================== Database Entity Interfaces ====================

export interface Provider {
  id: string;
  name: string;
  apiBaseUrl?: string;
  authType: AuthType;
  status: ProviderStatus;
  isLocal?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Model {
  name: string;
  providerName: string;
  pricingInputPer1k?: number;
  pricingOutputPer1k?: number;
  supportsThinking: boolean;
  maxTokens?: number;
  contextWindow?: number;
  strengths?: string[];
  weaknesses?: string[];
  useCases?: string[];
  status: ModelStatus;
  createdAt: string;
  updatedAt: string;
  // Joined data when fetching with provider
  provider?: Provider;
}

export interface CIDAFMCommand {
  id: string;
  type: CIDAFMCommandType;
  name: string;
  description?: string;
  defaultActive: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserCIDAFMCommand {
  id: string;
  userId: string;
  type: CIDAFMCommandType;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserUsageStats {
  id: string;
  userId: string;
  date: string; // Date string in YYYY-MM-DD format
  providerName?: string;
  modelName?: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  avgResponseTimeMs?: number;
  avgUserRating?: number;
  createdAt: string;
  updatedAt: string;
  // Joined data when fetching with relations
  provider?: Provider;
  model?: Model;
}

// ==================== Enhanced Message Types ====================

export interface MessageEvaluation {
  userRating?: UserRatingScale;
  speedRating?: UserRatingScale;
  accuracyRating?: UserRatingScale;
  userNotes?: string;
  evaluationTimestamp?: string;
}

export interface CIDAFMOptions {
  activeStateModifiers?: string[];
  responseModifiers?: string[];
  executedCommands?: string[];
  customOptions?: Record<string, unknown>;
}

export interface EvaluationDetails {
  additionalMetrics?: Record<string, number>;
  tags?: string[];
  feedback?: string;
  userContext?: string;
  modelConfidence?: number;
}

export interface LLMUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  responseTimeMs?: number;
  langsmithRunId?: string;

  // Data sanitization and privacy tracking
  dataSanitizationApplied?: boolean;
  sanitizationLevel?: 'none' | 'basic' | 'standard' | 'strict';
  piiDetected?: boolean;
  piiTypes?: string[]; // e.g., ['email', 'ssn', 'phone', 'credit_card']
  pseudonymsUsed?: number;
  pseudonymTypes?: string[]; // e.g., ['person_name', 'organization', 'location']
  // New: Full pseudonym mappings saved with usage
  pseudonymMappings?: Array<{
    original: string;
    pseudonym: string;
    dataType: string;
  }>;
  redactionsApplied?: number;
  redactionTypes?: string[]; // e.g., ['secret_key', 'password', 'api_key']
  showstopperDetected?: boolean; // Whether showstopper PII was detected
  patternRedactionsApplied?: number; // Count of pattern-based redactions
  patternRedactionTypes?: string[]; // Types of patterns that were redacted
  sourceBlindingApplied?: boolean;
  headersStripped?: number;
  customUserAgentUsed?: boolean;
  proxyUsed?: boolean;
  noTrainHeaderSent?: boolean;
  noRetainHeaderSent?: boolean;

  // Sanitization performance metrics
  sanitizationTimeMs?: number;
  reversalContextSize?: number; // Size of context needed for pseudonym reversal

  // Data classification
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
  policyProfile?: string; // e.g., 'healthcare', 'finance', 'standard'
  sovereignMode?: boolean;

  // Compliance tracking
  complianceFlags?: {
    gdprCompliant?: boolean;
    hipaaCompliant?: boolean;
    pciCompliant?: boolean;
    customCompliance?: Record<string, boolean>;
  };
}

export interface EnhancedMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  timestamp: string;
  order: number;
  metadata?: Record<string, unknown>;

  // LLM Selection
  providerName?: string;
  modelName?: string;

  // Usage Metrics
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  responseTimeMs?: number;
  langsmithRunId?: string;

  // Evaluation Data
  userRating?: UserRatingScale;
  speedRating?: UserRatingScale;
  accuracyRating?: UserRatingScale;
  userNotes?: string;
  evaluationTimestamp?: string;

  // CIDAFM and Additional Data
  cidafmOptions?: CIDAFMOptions;
  evaluationDetails?: EvaluationDetails;

  // Joined data when fetching with relations
  provider?: Provider;
  model?: Model;
}

// ==================== Cost Calculation Types ====================

export interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  estimatedCost?: number;
  currency: string;
}

export interface PricingInfo {
  inputPer1k: number;
  outputPer1k: number;
  currency: string;
  lastUpdated: string;
}

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  maxCostWarning?: string;
  currency: string;
}

// ==================== CIDAFM Processing Types ====================

export interface CIDAFMState {
  activeCommands: CIDAFMCommand[];
  userCommands: UserCIDAFMCommand[];
  sessionState: Record<string, unknown>;
}

export interface CIDAFMProcessingResult {
  modifiedPrompt: string;
  newState: CIDAFMState;
  executedCommands: string[];
  processingNotes?: string[];
}

export interface CIDAFMCommandExecution {
  command: string;
  type: CIDAFMCommandType;
  result: 'success' | 'error' | 'warning';
  message?: string;
  data?: Record<string, unknown>;
}

// ==================== Analytics and Reporting Types ====================

export interface UsageAnalytics {
  userId: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  averageResponseTime: number;
  averageUserRating?: number;

  // Breakdown by provider/model
  byProvider: Array<{
    provider: Provider;
    requests: number;
    tokens: number;
    cost: number;
    avgRating?: number;
  }>;

  byModel: Array<{
    model: Model;
    requests: number;
    tokens: number;
    cost: number;
    avgRating?: number;
  }>;

  // Daily breakdown
  dailyStats: Array<{
    date: string;
    requests: number;
    tokens: number;
    cost: number;
    avgResponseTime?: number;
  }>;
}

export interface ModelPerformanceMetrics {
  model: Model;
  totalUses: number;
  averageRating: number;
  averageResponseTime: number;
  averageCostPerMessage: number;
  userFeedbackCount: number;
  strengthsMentioned: string[];
  weaknessesMentioned: string[];
  recommendedUseCases: string[];
}

// ==================== Frontend UI Types ====================

export interface LLMSelectionState {
  selectedProvider?: Provider;
  selectedModel?: Model;
  availableProviders: Provider[];
  availableModels: Model[];
  loading: boolean;
  error?: string;
}

export interface CIDAFMControlsState {
  availableCommands: CIDAFMCommand[];
  userCommands: UserCIDAFMCommand[];
  activeStateModifiers: string[];
  selectedResponseModifiers: string[];
  pendingExecutionCommands: string[];
  customCommandInput: string;
  loading: boolean;
  error?: string;
}

export interface EvaluationUIState {
  messageId: string;
  ratings: {
    overall?: UserRatingScale;
    speed?: UserRatingScale;
    accuracy?: UserRatingScale;
  };
  notes: string;
  submitting: boolean;
  submitted: boolean;
  error?: string;
}

// ==================== API Request/Response Types ====================

export interface LLMSelectionRequest {
  providerName: string;
  modelName: string;
  cidafmOptions?: CIDAFMOptions;
}

export interface MessageEvaluationRequest {
  userRating?: UserRatingScale;
  speedRating?: UserRatingScale;
  accuracyRating?: UserRatingScale;
  userNotes?: string;
  evaluationDetails?: EvaluationDetails;
}

export interface UsageStatsRequest {
  startDate?: string;
  endDate?: string;
  providerName?: string;
  modelName?: string;
  includeDetails?: boolean;
}

export interface CIDAFMCommandRequest {
  type: CIDAFMCommandType;
  name: string;
  description?: string;
}

// ==================== Utility Types ====================

export interface ModelCapabilities {
  supportsThinking: boolean;
  supportsMultimodal: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  maxContextLength: number;
  recommendedFor: string[];
}

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  rateLimits: {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
  authenticationMethods: AuthType[];
}
