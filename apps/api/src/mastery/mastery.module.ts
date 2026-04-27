import { Module, forwardRef } from '@nestjs/common';
import { FirstTouchModule } from '../first-touch/first-touch.module';
import { MarketsModule } from '../markets/markets.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { MasteryController } from './mastery.controller';
import { MasterySchemaService } from './mastery-schema.service';
import { MasteryService } from './mastery.service';

@Module({
  imports: [FirstTouchModule, OnboardingModule, forwardRef(() => MarketsModule)],
  controllers: [MasteryController],
  providers: [MasterySchemaService, MasteryService],
  exports: [MasterySchemaService, MasteryService],
})
export class MasteryModule {}
