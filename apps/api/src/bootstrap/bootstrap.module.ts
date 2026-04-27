import { Module } from '@nestjs/common';
import { A2AModule } from '../a2a/a2a.module';
import { BillingModule } from '../billing/billing.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { FirstTouchModule } from '../first-touch/first-touch.module';
import { LearningPanelModule } from '../learning-panel/learning-panel.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SchemaBootstrapService } from './schema-bootstrap.service';
import { SchemaReadinessService } from './schema-readiness.service';

@Module({
  imports: [
    A2AModule,
    BillingModule,
    CredentialsModule,
    FirstTouchModule,
    LearningPanelModule,
    OnboardingModule,
  ],
  providers: [SchemaBootstrapService, SchemaReadinessService],
  exports: [SchemaBootstrapService, SchemaReadinessService],
})
export class BootstrapModule {}
