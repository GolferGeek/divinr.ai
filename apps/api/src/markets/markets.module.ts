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
import { CrawlerService } from './services/crawler.service';
import { PredictorGeneratorService } from './services/predictor-generator.service';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { OutcomeTrackingService } from './services/outcome-tracking.service';

@Module({
  controllers: [MarketsController],
  providers: [
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
    UserPortfolioService,
    EodSettlementService,
    OrchestratorBaseDataService,
    CrawlerService,
    PredictorGeneratorService,
    PredictionGeneratorService,
    OutcomeTrackingService,
    MarketsService,
  ],
})
export class MarketsModule {}
