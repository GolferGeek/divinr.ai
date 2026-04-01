import type {
  PredictionPlane,
  PredictionPlaneIngest,
  PredictionPlaneState,
  PredictionPlaneEvaluation,
  PredictionPlanePresentation,
  DomainSource,
  InstrumentState,
  SyncConfig,
  SyncResult,
} from '../prediction-plane.interface';
import { StocksStateService } from './stocks-state.service';
import { StocksEvaluationService } from './stocks-evaluation.service';
import { StocksPresentation } from './stocks-presentation';

class StocksIngestService implements PredictionPlaneIngest {
  async getCurrentState(_instrumentId: string): Promise<InstrumentState> {
    // TODO: Integrate with market data API (Yahoo Finance, Alpha Vantage, etc.)
    return { data: {}, asOf: new Date().toISOString() };
  }

  async getHistoricalState(_instrumentId: string, asOf: Date): Promise<InstrumentState> {
    // TODO: Fetch historical price data for the given date
    return { data: {}, asOf: asOf.toISOString() };
  }

  async getAvailableSources(): Promise<DomainSource[]> {
    return [
      { id: 'source_marketwatch', name: 'MarketWatch', type: 'news', url: 'https://www.marketwatch.com' },
      { id: 'source_reuters', name: 'Reuters', type: 'news', url: 'https://www.reuters.com' },
    ];
  }

  async syncExternalData(_config: SyncConfig): Promise<SyncResult> {
    // Delegated to the existing syncExternalCrawlerData in MarketsService
    return { sourcesProcessed: 0, articlesProcessed: 0, syncedAt: new Date().toISOString() };
  }
}

export class StocksPredictionPlane implements PredictionPlane {
  readonly domain = 'financial';
  readonly ingest: PredictionPlaneIngest;
  readonly state: PredictionPlaneState;
  readonly evaluation: PredictionPlaneEvaluation;
  readonly presentation: PredictionPlanePresentation;

  constructor() {
    this.ingest = new StocksIngestService();
    this.state = new StocksStateService();
    this.evaluation = new StocksEvaluationService();
    this.presentation = new StocksPresentation();
  }
}
