export type RunType = 'risk' | 'prediction';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AnalystType = 'personality' | 'context_provider' | 'portfolio_manager';
export type WorkflowScope = 'prediction' | 'risk' | 'both' | 'trade';

export type TradeAction = 'buy' | 'sell' | 'hold';

export interface TradeRecommendation {
  id: string;
  run_id: string;
  instrument_id: string;
  symbol: string;
  // The action the portfolio manager recommends.
  action: TradeAction;
  // Sizing
  position_percent: number; // 0-1, fraction of portfolio
  kelly_fraction_raw: number; // pre-clamp Kelly result
  kelly_fraction_applied: number; // post-clamp, post-risk-adjustment
  quantity: number; // shares
  // Pricing
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  // Inputs that drove the decision
  arbitrator_direction: 'up' | 'down' | 'flat';
  arbitrator_confidence: number; // 0-100
  calibration_adjusted_confidence: number; // 0-100
  composite_risk_score: number | null; // 0-100
  consensus_bullish_count: number;
  consensus_bearish_count: number;
  consensus_total: number;
  // Status
  is_calibrating: boolean;
  rationale: string;
  created_at: string;
}

export interface MarketInstrument {
  id: string;
  user_id: string | null;
  symbol: string;
  name: string;
  asset_type: string;
  universe_slug: string;
  current_state: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface CreateInstrumentInput {
  userId: string;
  symbol: string;
  name?: string;
  assetType?: string;
}

export interface TierInstructions {
  gold?: string;
  silver?: string;
  bronze?: string;
}

export interface MarketAnalyst {
  id: string;
  user_id: string | null;
  slug: string;
  display_name: string;
  analyst_type: AnalystType;
  persona_prompt: string;
  tier_instructions: TierInstructions;
  default_weight: number;
  is_system_default: boolean;
  is_enabled: boolean;
  is_active: boolean;
  workflow_scope: WorkflowScope;
  domain_slug: string;
  universe_slug: string | null;
  current_config_version_id: string | null;
  paper_config_version_id: string | null;
  learning_enabled: boolean;
  memory_patterns: Array<{ pattern: string; instruments?: string[]; confidence: number; source_run_id?: string; created_at: string }>;
  memory_corrections: Array<{ correction: string; source_run_id?: string; created_at: string }>;
  memory_instrument_notes: Record<string, Array<{ note: string; created_at: string }>>;
  memory_calibration: { predictions_made?: number; correct?: number; by_confidence_band?: Record<string, { total: number; correct: number }> };
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAnalystInput {
  userId: string;
  slug: string;
  displayName: string;
  personaPrompt: string;
}

export interface AssignAnalystInput {
  userId: string;
  instrumentId: string;
  analystId: string;
}

export interface MarketSource {
  id: string;
  source_key: string;
  display_name: string;
  base_url: string | null;
  tier: string;
  is_global_default: boolean;
  source_origin?: string;
  external_source_id?: string | null;
  created_at: string;
}

export interface SourceEntitlement {
  source_id: string;
  is_enabled: boolean;
  override_notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertSourceEntitlementInput {
  userId: string;
  sourceId: string;
  isEnabled: boolean;
  overrideNotes?: string;
}

export interface CreateRunInput {
  userId: string;
  instrumentId: string;
  runType: RunType;
}

export interface MarketRun {
  id: string;
  instrument_id: string;
  run_type: RunType;
  status: RunStatus;
  requested_by: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

export interface UpdateRunStatusInput {
  userId: string;
  runId: string;
  status: RunStatus;
  errorMessage?: string;
}

export interface ListRunsInput {
  userId: string;
  status?: RunStatus;
}

export interface ProcessNextRunInput {
  userId: string;
}

export interface ProcessNextRunResult {
  processed: boolean;
  runId?: string;
  status?: RunStatus;
  runType?: RunType;
  artifactId?: string;
}

export interface ProcessRunsInput extends ProcessNextRunInput {
  maxRuns?: number;
}

export interface ProcessRunsResult {
  requested: number;
  processedCount: number;
  results: ProcessNextRunResult[];
}

export interface RunArtifact {
  id: string;
  run_id: string;
  run_type: RunType;
  analyst_id: string | null;
  model_provider: string;
  model_name: string;
  prompt: string;
  output_text: string;
  created_at: string;
}

export interface PredictionOutcome {
  id: string;
  run_id: string;
  instrument_id: string;
  analyst_id: string | null;
  predicted_direction: 'up' | 'down' | 'flat';
  confidence: number;
  horizon_minutes: number;
  rationale: string;
  created_at: string;
}

export type PredictorStatus = 'active' | 'dismissed';

export type CrowdReaction = 'fear_trigger' | 'greed_trigger' | 'noise';

export interface MarketPredictor {
  id: string;
  instrument_id: string;
  article_id: string;
  relevance_score: number;
  status: PredictorStatus;
  rationale: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  crowd_reaction?: CrowdReaction | null;
  crowd_reaction_confidence?: number | null;
  crowd_reaction_rationale?: string | null;
  estimated_reaction_window_minutes?: number | null;
}

export interface UpsertPredictorInput {
  userId: string;
  instrumentId: string;
  articleId: string;
  relevanceScore: number;
  rationale?: string;
  status?: PredictorStatus;
}

export interface ListPredictorsInput {
  userId: string;
  instrumentId: string;
  status?: PredictorStatus | 'all';
}

export interface RiskAssessment {
  id: string;
  run_id: string;
  instrument_id: string;
  risk_score: number;
  verdict: 'low' | 'medium' | 'high';
  rationale: string;
  created_at: string;
}

export interface EvaluateRunInput {
  userId: string;
  runId: string;
  actualDirection: 'up' | 'down' | 'flat';
}

export interface ReplayRunInput {
  userId: string;
  runId: string;
  scenario: string;
}

export interface RunEvaluation {
  id: string;
  run_id: string;
  actual_direction: 'up' | 'down' | 'flat';
  predicted_direction: 'up' | 'down' | 'flat' | null;
  was_correct: boolean | null;
  notes: string | null;
  created_at: string;
}

export interface RunReplay {
  id: string;
  run_id: string;
  scenario: string;
  replay_output: string;
  created_at: string;
}

export interface ListRunArtifactsInput {
  userId: string;
  runId: string;
}

export interface ListPredictionOutcomesInput {
  userId: string;
  runId?: string;
  instrumentId?: string;
}

export interface ListRiskAssessmentsInput {
  userId: string;
  runId?: string;
  instrumentId?: string;
  role?: string;
}

export interface MarketArticle {
  id: string;
  external_article_id: string;
  external_source_id: string;
  source_id: string;
  source_origin: string;
  external_source_slug: string;
  title: string | null;
  url: string;
  summary: string | null;
  author: string | null;
  content: string | null;
  content_hash: string | null;
  published_at: string | null;
  first_seen_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ListMarketArticlesInput {
  userId: string;
  sourceId?: string;
  limit?: number;
}

export interface ExternalCrawlerSyncInput {
  userId: string;
  force?: boolean;
}

export interface ExternalCrawlerSyncResult {
  enabled: boolean;
  externalSourceSlug: string | null;
  sourceRowsProcessed: number;
  articleRowsProcessed: number;
  totalSyncedSources: number;
  totalSyncedArticles: number;
  syncedAt: string;
  message: string;
}

// ─── Domain / Universe ───────────────────────────────────────────

export interface Domain {
  slug: string;
  display_name: string;
  description: string | null;
  prediction_plane: string;
  is_active: boolean;
  created_at: string;
}

export interface Universe {
  slug: string;
  domain_slug: string;
  display_name: string;
  description: string | null;
  default_evaluation_horizons: number[];
  horizon_unit: 'hours' | 'days' | 'weeks';
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Analyst Versioning ──────────────────────────────────────────

export type ConfigVersionSource = 'manual' | 'tier1_auto' | 'tier2_approved' | 'tier3_strategic';

export interface AnalystConfigVersion {
  id: string;
  analyst_id: string;
  version_number: number;
  persona_prompt: string;
  tier_instructions: TierInstructions;
  default_weight: number;
  config_overrides: Record<string, unknown>;
  source: ConfigVersionSource;
  change_reason: string | null;
  parent_version_id: string | null;
  canonical_test_score: number | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

// ─── Risk Dimensions ─────────────────────────────────────────────

export interface RiskDimension {
  id: string;
  user_id: string | null;
  domain_slug: string;
  slug: string;
  name: string;
  description: string | null;
  weight: number;
  display_order: number;
  is_active: boolean;
  system_prompt: string | null;
  output_schema: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RiskDimensionAssessment {
  id: string;
  run_id: string;
  instrument_id: string;
  dimension_id: string;
  score: number;
  confidence: number;
  reasoning: string;
  evidence: string[];
  signals: unknown[];
  model_provider: string | null;
  model_name: string | null;
  llm_usage_id: string | null;
  created_at: string;
}

export interface RiskCompositeScore {
  id: string;
  run_id: string;
  instrument_id: string;
  overall_score: number;
  dimension_scores: Record<string, number>;
  debate_id: string | null;
  debate_adjustment: number;
  pre_debate_score: number | null;
  confidence: number;
  status: 'active' | 'superseded';
  created_at: string;
}

// ─── Risk Debates ────────────────────────────────────────────────

export type DebateRole = 'blue' | 'red' | 'arbiter';
export type DebateStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface BlueAssessment {
  summary: string;
  key_findings: string[];
  evidence_cited: string[];
  confidence_explanation: string;
}

export interface RedChallenges {
  challenges: string[];
  blind_spots: string[];
  overstated_risks: string[];
  understated_risks: string[];
}

export interface ArbiterSynthesis {
  final_assessment: string;
  accepted_challenges: string[];
  rejected_challenges: string[];
  adjustment_reasoning: string;
  recommended_adjustment: number;
}

export interface RiskDebate {
  id: string;
  run_id: string;
  instrument_id: string;
  composite_score_id: string | null;
  blue_assessment: BlueAssessment;
  red_challenges: RedChallenges;
  arbiter_synthesis: ArbiterSynthesis;
  original_score: number | null;
  final_score: number | null;
  score_adjustment: number;
  transcript: unknown[];
  status: DebateStatus;
  created_at: string;
  completed_at: string | null;
}

export interface RiskDebateContext {
  id: string;
  user_id: string | null;
  domain_slug: string;
  role: DebateRole;
  version: number;
  system_prompt: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Learning System ─────────────────────────────────────────────

export interface PredictionHorizonEvaluation {
  id: string;
  prediction_id: string;
  run_id: string;
  instrument_id: string;
  analyst_id: string | null;
  horizon_window: number;
  prediction_date: string;
  evaluation_date: string;
  predicted_direction: 'up' | 'down' | 'flat';
  actual_direction: 'up' | 'down' | 'flat';
  actual_outcome_data: Record<string, unknown>;
  was_correct: boolean;
  confidence_at_prediction: number | null;
  created_at: string;
}

export interface AnalystPerformanceProfile {
  id: string;
  analyst_id: string;
  instrument_id: string | null;
  horizon_window: number;
  period: '7d' | '30d' | 'all';
  accuracy_rate: number | null;
  avg_confidence: number | null;
  calibration_score: number | null;
  systematic_biases: Record<string, unknown>;
  sample_size: number;
  computed_at: string;
}

export type CanonicalTestScope = 'prediction' | 'risk' | 'both';

export interface CanonicalTestDay {
  id: string;
  instrument_id: string;
  user_id: string | null;
  universe_slug: string;
  canonical_date: string;
  failure_classification: string;
  articles_snapshot: unknown[];
  predictor_state_snapshot: unknown[];
  risk_analysis_snapshot: Record<string, unknown>;
  risk_config_snapshot: Record<string, unknown>;
  analyst_config_snapshot: Record<string, unknown>;
  original_prediction: Record<string, unknown>;
  original_risk_assessment: Record<string, unknown>;
  actual_outcome: Record<string, unknown>;
  test_scope: CanonicalTestScope;
  is_active: boolean;
  added_at: string;
  retired_at: string | null;
  added_by: string;
}

export type LearningProposalStatus =
  | 'proposed' | 'testing' | 'passed' | 'failed'
  | 'approved' | 'rejected' | 'applied' | 'reverted';

export interface LearningProposal {
  id: string;
  user_id: string | null;
  tier: 1 | 2 | 3;
  analyst_id: string | null;
  instrument_id: string | null;
  proposal_type: string;
  description: string;
  rationale: string;
  proposed_change: Record<string, unknown>;
  canonical_test_results: Record<string, unknown> | null;
  net_score: number | null;
  has_severity_regression: boolean | null;
  status: LearningProposalStatus;
  proposed_at: string;
  tested_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
}

// ─── Multi-Analyst Run Types ─────────────────────────────────────

export type AnalystRole = 'analyst' | 'arbitrator';

export interface MultiAnalystPrediction extends PredictionOutcome {
  role: AnalystRole;
  lineage_json: Record<string, unknown> | null;
  key_factors: string[];
  risks: string[];
  config_version_id: string | null;
}

export interface ScorePredictorInput {
  userId: string;
  instrumentId: string;
  articleId: string;
}

export interface ScorePredictorBatchInput {
  userId: string;
  instrumentId: string;
  articleIds: string[];
}

export interface ScorePredictorResult {
  predictor: MarketPredictor;
  relevanceScore: number;
  rationale: string;
  dismissed: boolean;
}

export interface ScorePredictorBatchResult {
  results: Array<ScorePredictorResult | { articleId: string; error: string }>;
  scored: number;
  failed: number;
}

export interface MultiAnalystRunResult {
  processed: boolean;
  runId?: string;
  status?: RunStatus;
  runType?: RunType;
  analystOutcomes: PredictionOutcome[];
  arbitratorOutcome: PredictionOutcome | null;
  artifactIds: string[];
  partialFailures: Array<{ analystId: string; error: string }>;
}

// ─── Portfolio System ────────────────────────────────────────────

export type PortfolioStatus = 'active' | 'warning' | 'probation' | 'suspended';
export type PositionDirection = 'long' | 'short';
export type PositionStatus = 'open' | 'closed';
export type TradeQueueStatus = 'queued' | 'executed' | 'cancelled';

export interface AnalystPortfolio {
  id: string;
  analyst_id: string;
  user_id: string | null;
  initial_balance: number;
  current_balance: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  win_count: number;
  loss_count: number;
  status: PortfolioStatus;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalystPosition {
  id: string;
  portfolio_id: string;
  analyst_id: string;
  prediction_id: string | null;
  instrument_id: string;
  symbol: string;
  direction: PositionDirection;
  quantity: number;
  entry_price: number;
  current_price: number;
  exit_price: number | null;
  unrealized_pnl: number;
  realized_pnl: number | null;
  is_paper_only: boolean;
  status: PositionStatus;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPortfolio {
  id: string;
  user_id: string;
  initial_balance: number;
  current_balance: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  created_at: string;
  updated_at: string;
}

export interface UserTradeQueueEntry {
  id: string;
  user_id: string;
  portfolio_id: string;
  prediction_id: string;
  instrument_id: string;
  symbol: string;
  direction: PositionDirection;
  quantity: number;
  status: TradeQueueStatus;
  executed_position_id: string | null;
  execution_price: number | null;
  executed_at: string | null;
  queued_at: string;
  created_at: string;
}

export interface EodSettlementLog {
  id: string;
  settlement_date: string;
  queued_trades_executed: number;
  analyst_positions_created: number;
  predictions_resolved: number;
  positions_closed: number;
  unrealized_pnl_updated: number;
  total_realized_pnl: number;
  errors: string[];
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface PositionSizingTier {
  id: string;
  tier_name: string;
  min_confidence: number;
  max_confidence: number;
  position_percent: number;
}

// ─── User-Analyst Affinity ──────────────────────────────────

export type AffinitySignalType =
  | 'buy_agreement'
  | 'sell_agreement'
  | 'skip_disagreement'
  | 'challenge_accept'
  | 'challenge_reject'
  | 'browse_interest';

export interface AffinitySignal {
  id: string;
  user_id: string;
  analyst_id: string;
  signal_type: AffinitySignalType;
  prediction_id: string | null;
  instrument_id: string | null;
  weight: number;
  created_at: string;
}

export interface UserAnalystAffinity {
  id: string;
  user_id: string;
  analyst_id: string;
  affinity_score: number;
  signal_count: number;
  buy_agreement: number;
  skip_disagreement: number;
  challenge_accept: number;
  challenge_reject: number;
  browse_signals: number;
  last_signal_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Unified Notifications ──────────────────────────────────

export type NotificationEventType =
  | 'stop_loss'
  | 'trade_recommendation'
  | 'tier3_proposal'
  | 'nightly_eval'
  | 'contrarian_alert'
  | 'fear_greed_alert';

export type NotificationUrgency = 'immediate' | 'actionable' | 'informational';

export interface Notification {
  id: string;
  user_id: string;
  event_type: NotificationEventType;
  urgency: NotificationUrgency;
  title: string;
  summary: string | null;
  link_to: string;
  is_read: boolean;
  created_at: string;
}

export interface FearGreedAlert {
  id: string;
  user_id: string;
  predictor_id: string;
  instrument_id: string;
  symbol: string;
  crowd_reaction: 'fear_trigger' | 'greed_trigger';
  crowd_reaction_confidence: number;
  estimated_reaction_window_minutes: number | null;
  trade_action: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  notification_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ContrarianAlert {
  id: string;
  user_id: string;
  analyst_id: string;
  prediction_id: string;
  instrument_id: string;
  symbol: string;
  user_weighted_direction: 'up' | 'down' | 'flat';
  contrarian_direction: 'up' | 'down' | 'flat';
  contrarian_confidence: number;
  affinity_score_at_alert: number;
  rationale: string;
  is_read: boolean;
  created_at: string;
}
