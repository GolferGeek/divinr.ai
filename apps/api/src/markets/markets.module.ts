import { Module } from '@nestjs/common';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';
import { MarketsSchemaService } from './schema/markets-schema.service';
import { MarketsLlmService } from './services/markets-llm.service';
import { ContextProviderService } from './services/context-provider.service';
import { RiskDimensionAnalyzerService } from './services/risk-dimension-analyzer.service';
import { RiskScoreAggregationService } from './services/risk-score-aggregation.service';
import { RiskDebateService } from './services/risk-debate.service';
import { RiskRunnerService } from './services/risk-runner.service';
import { PredictionRunnerService } from './services/prediction-runner.service';
import { NightlyEvaluationService } from './services/nightly-evaluation.service';
import { CanonicalTestRunnerService } from './services/canonical-test-runner.service';
import { LearningEngineService } from './services/learning-engine.service';
import { PositionSizingService } from './services/position-sizing.service';
import { AnalystPortfolioService } from './services/analyst-portfolio.service';
import { UserPortfolioService } from './services/user-portfolio.service';
import { EodSettlementService } from './services/eod-settlement.service';
import { OrchestratorBaseDataService } from './services/orchestrator-base-data.service';
import { AnalystPipelineService } from './services/analyst-pipeline.service';
import { CrawlerService } from './services/crawler.service';
import { PredictorGeneratorService } from './services/predictor-generator.service';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { OutcomeTrackingService } from './services/outcome-tracking.service';
import { DataSourceService } from './services/data-source.service';
import { TradeRecommendationService } from './services/trade-recommendation.service';
import { ConvictionTraderService } from './services/conviction-trader.service';
import { StopLossWatcherService } from './services/stop-loss-watcher.service';
import { EodForcedBuyService } from './services/eod-forced-buy.service';
import { AutotradeOpenHelper } from './services/autotrade-open-helper.service';
import { LeaderboardService } from './services/leaderboard.service';
import { MonthlyResetService } from './services/monthly-reset.service';
import { BenchmarkIngestService } from './services/benchmark-ingest.service';
import { DayTraderRunnerService } from './services/day-trader-runner.service';
import { AuditService } from './services/audit.service';
import { StrategicOverhaulService } from './services/strategic-overhaul.service';
import { AffinityService } from './services/affinity.service';
import { NotificationService } from './services/notification.service';
import { FearGreedAlertService } from './services/fear-greed-alert.service';
import { CoordinationService } from './services/coordination.service';
import { PerformanceService } from './services/performance.service';
import { ArticleRelevanceService } from './services/article-relevance.service';
import { WiringService } from './services/wiring.service';
import { ActiveAuthorshipService } from './services/active-authorship.service';
import { EnablementService } from './services/enablement.service';
import { MessagingSchemaService } from '../messaging/messaging-schema.service';
import { MessagingService } from '../messaging/messaging.service';
import { TournamentModule } from '../tournaments/tournament.module';
import { BillingModule } from '../billing/billing.module';
import { PolygonAdapter } from './adapters/polygon.adapter';
import { FmpAdapter } from './adapters/fmp.adapter';
import { TwelveDataAdapter } from './adapters/twelve-data.adapter';
import { FinnhubAdapter } from './adapters/finnhub.adapter';
import { FredAdapter } from './adapters/fred.adapter';
import { SecEdgarAdapter } from './adapters/sec-edgar.adapter';
import { RedditAdapter } from './adapters/reddit.adapter';

@Module({
  imports: [TournamentModule, BillingModule],
  controllers: [MarketsController],
  providers: [
    PolygonAdapter,
    FmpAdapter,
    TwelveDataAdapter,
    FinnhubAdapter,
    FredAdapter,
    SecEdgarAdapter,
    RedditAdapter,
    MarketsSchemaService,
    MarketsLlmService,
    ContextProviderService,
    RiskDimensionAnalyzerService,
    RiskScoreAggregationService,
    RiskDebateService,
    RiskRunnerService,
    PredictionRunnerService,
    NightlyEvaluationService,
    CanonicalTestRunnerService,
    LearningEngineService,
    PositionSizingService,
    AnalystPortfolioService,
    AutotradeOpenHelper,
    UserPortfolioService,
    EodSettlementService,
    OrchestratorBaseDataService,
    AnalystPipelineService,
    CrawlerService,
    PredictorGeneratorService,
    PredictionGeneratorService,
    OutcomeTrackingService,
    DataSourceService,
    TradeRecommendationService,
    ConvictionTraderService,
    StopLossWatcherService,
    EodForcedBuyService,
    LeaderboardService,
    MonthlyResetService,
    BenchmarkIngestService,
    DayTraderRunnerService,
    AuditService,
    StrategicOverhaulService,
    AffinityService,
    NotificationService,
    FearGreedAlertService,
    CoordinationService,
    PerformanceService,
    ArticleRelevanceService,
    WiringService,
    ActiveAuthorshipService,
    EnablementService,
    MarketsService,
    MessagingSchemaService,
    MessagingService,
  ],
  exports: [MarketsService, AnalystPortfolioService, TradeRecommendationService],
})
export class MarketsModule {}
