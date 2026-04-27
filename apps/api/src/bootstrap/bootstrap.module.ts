import { Module } from '@nestjs/common';
import { A2AModule } from '../a2a/a2a.module';
import { InviteSchemaService } from '../auth/invite-schema.service';
import { BillingModule } from '../billing/billing.module';
import { ClubModule } from '../clubs/club.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { FirstTouchModule } from '../first-touch/first-touch.module';
import { LearningPanelModule } from '../learning-panel/learning-panel.module';
import { MarketsModule } from '../markets/markets.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TournamentModule } from '../tournaments/tournament.module';
import { SchemaBootstrapService } from './schema-bootstrap.service';
import { SchemaReadinessService } from './schema-readiness.service';

@Module({
  imports: [
    A2AModule,
    BillingModule,
    ClubModule,
    CredentialsModule,
    CurriculumModule,
    FirstTouchModule,
    LearningPanelModule,
    MarketsModule,
    OnboardingModule,
    TournamentModule,
  ],
  providers: [InviteSchemaService, SchemaBootstrapService, SchemaReadinessService],
  exports: [InviteSchemaService, SchemaBootstrapService, SchemaReadinessService],
})
export class BootstrapModule {}
