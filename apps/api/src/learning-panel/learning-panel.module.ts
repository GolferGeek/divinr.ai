import { Module, forwardRef } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { FirstTouchModule } from '../first-touch/first-touch.module';
import { MarketsModule } from '../markets/markets.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { LearningPanelController } from './learning-panel.controller';
import { LearningPanelContextService } from './learning-panel-context.service';
import { LearningPanelCorpusService } from './learning-panel-corpus.service';
import { LearningPanelSchemaService } from './learning-panel-schema.service';
import { LearningPanelService } from './learning-panel.service';

@Module({
  imports: [
    forwardRef(() => MarketsModule),
    FirstTouchModule,
    OnboardingModule,
    CredentialsModule,
  ],
  controllers: [LearningPanelController],
  providers: [
    LearningPanelSchemaService,
    LearningPanelCorpusService,
    LearningPanelContextService,
    LearningPanelService,
  ],
  exports: [LearningPanelService, LearningPanelSchemaService],
})
export class LearningPanelModule {}
