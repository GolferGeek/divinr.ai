import { Module, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { MarketsModule } from '../markets/markets.module';
import { NightlyEvaluationService } from '../markets/services/nightly-evaluation.service';
import { OutcomeAttributionService } from './outcome-attribution.service';
import { AttributionAggregationService } from './attribution-aggregation.service';
import { AttributionQueryService } from './attribution-query.service';
import { AdminAttributionController } from './admin-attribution.controller';
import { AuthorAttributionController } from './author-attribution.controller';

@Module({
  imports: [MarketsModule],
  controllers: [AdminAttributionController, AuthorAttributionController],
  providers: [OutcomeAttributionService, AttributionAggregationService, AttributionQueryService],
  exports: [OutcomeAttributionService, AttributionAggregationService, AttributionQueryService],
})
export class AttributionModule implements OnModuleInit {
  private readonly logger = new Logger(AttributionModule.name);

  constructor(
    @Inject(NightlyEvaluationService) private readonly nightly: NightlyEvaluationService,
    @Inject(OutcomeAttributionService) private readonly outcomes: OutcomeAttributionService,
  ) {}

  onModuleInit(): void {
    this.nightly.setOnEvaluationCycleComplete(
      (runStartedAt) => this.outcomes.recordOutcomesForEvaluationRun(runStartedAt).then(() => undefined),
    );
    this.logger.log('Registered outcome-attribution hook on NightlyEvaluationService');
  }
}
