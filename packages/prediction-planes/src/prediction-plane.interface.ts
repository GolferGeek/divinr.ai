/**
 * PredictionPlane — domain-specific abstraction for prediction workflows.
 *
 * Each prediction domain (stocks, sports, elections) implements this interface
 * to handle the parts of the pipeline that vary by domain: data ingestion,
 * instrument state formatting, outcome evaluation, and UI presentation.
 *
 * The orchestration engine (ensemble, arbitration, learning) is domain-agnostic
 * and calls into the plane for anything domain-specific.
 */

// ─── Core Types ──────────────────────────────────────────────────

export interface InstrumentState {
  /** Domain-specific state data (price/odds/polls stored as key-value) */
  data: Record<string, unknown>;
  /** When this state was captured */
  asOf: string;
}

export interface PrimaryMetric {
  /** The main value (price, spread, polling average) */
  value: number;
  /** Human-readable label */
  label: string;
  /** Change from previous period, if applicable */
  change?: number;
  /** Change as percentage */
  changePct?: number;
}

export interface ActualOutcome {
  /** Domain-specific outcome data */
  data: Record<string, unknown>;
  /** Simplified direction for cross-domain comparison */
  direction: 'up' | 'down' | 'flat';
  /** When the outcome was determined */
  determinedAt: string;
}

export interface EvaluationScore {
  wasCorrect: boolean;
  /** 0-1 score for partial correctness */
  accuracy: number;
  /** Confidence calibration (was confidence proportional to accuracy?) */
  calibration: number;
  details: Record<string, unknown>;
}

export interface EvaluationHorizon {
  /** Number of units (e.g. 1, 3, 5) */
  value: number;
  /** Unit type */
  unit: 'hours' | 'days' | 'weeks';
  /** Human-readable label */
  label: string;
}

// ─── Presentation Types ──────────────────────────────────────────

export interface CardFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'badge' | 'trend' | 'percentage';
  format?: string;
}

export interface DashboardLayout {
  /** Domain display name */
  title: string;
  /** Widget sections in display order */
  sections: Array<{
    id: string;
    title: string;
    type: 'chart' | 'grid' | 'cards' | 'gauge' | 'map' | 'table';
    config: Record<string, unknown>;
  }>;
}

export interface PredictionDisplayConfig {
  /** How to show the direction (arrow, badge, text) */
  directionFormat: 'arrow' | 'badge' | 'text' | 'probability';
  /** Show confidence as bar, percentage, or gauge */
  confidenceFormat: 'bar' | 'percentage' | 'gauge';
  /** Show horizon in what format */
  horizonFormat: 'relative' | 'absolute' | 'event';
}

export interface VisualizationType {
  id: string;
  label: string;
  component: string;
}

// ─── Sync Types ──────────────────────────────────────────────────

export interface SyncConfig {
  organizationSlug: string;
  limit?: number;
  lookbackDays?: number;
}

export interface SyncResult {
  sourcesProcessed: number;
  articlesProcessed: number;
  syncedAt: string;
}

export interface DomainSource {
  id: string;
  name: string;
  type: string;
  url?: string;
}

// ─── The Plane Contract ──────────────────────────────────────────

export interface PredictionPlaneIngest {
  getCurrentState(instrumentId: string): Promise<InstrumentState>;
  getHistoricalState(instrumentId: string, asOf: Date): Promise<InstrumentState>;
  getAvailableSources(): Promise<DomainSource[]>;
  syncExternalData(config: SyncConfig): Promise<SyncResult>;
}

export interface PredictionPlaneState {
  getPrimaryMetric(state: InstrumentState): PrimaryMetric;
  formatMetric(metric: PrimaryMetric): string;
  getPromptContext(symbol: string, name: string, state: InstrumentState): string;
}

export interface PredictionPlaneEvaluation {
  evaluateOutcome(
    instrumentId: string,
    predictionDate: Date,
    evaluationDate: Date,
  ): Promise<ActualOutcome>;
  scorePrediction(
    predicted: { direction: string; confidence: number },
    actual: ActualOutcome,
  ): EvaluationScore;
  getDefaultHorizons(): EvaluationHorizon[];
}

export interface PredictionPlanePresentation {
  getDashboardLayout(): DashboardLayout;
  getInstrumentCardFields(): CardFieldDefinition[];
  getPredictionDisplayFormat(): PredictionDisplayConfig;
  getVisualizationTypes(): VisualizationType[];
}

export interface PredictionPlane {
  readonly domain: string;
  readonly ingest: PredictionPlaneIngest;
  readonly state: PredictionPlaneState;
  readonly evaluation: PredictionPlaneEvaluation;
  readonly presentation: PredictionPlanePresentation;
}
