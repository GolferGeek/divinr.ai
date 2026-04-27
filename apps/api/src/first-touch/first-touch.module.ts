import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { FirstTouchController } from './first-touch.controller';
import { FirstTouchSchemaService } from './first-touch-schema.service';
import { FirstTouchService } from './first-touch.service';

@Module({
  imports: [OnboardingModule],
  controllers: [FirstTouchController],
  providers: [FirstTouchSchemaService, FirstTouchService],
  exports: [FirstTouchService, FirstTouchSchemaService],
})
export class FirstTouchModule {}
