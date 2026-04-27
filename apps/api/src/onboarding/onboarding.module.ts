import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingSchemaService } from './onboarding-schema.service';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingSchemaService, OnboardingService],
  exports: [OnboardingService, OnboardingSchemaService],
})
export class OnboardingModule {}
