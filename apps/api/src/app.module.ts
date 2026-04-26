import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { resolve } from 'path';
import {
  DatabaseModule,
  LLMPlaneModule,
  ObservabilityPlaneModule,
  ConfigProviderModule,
  AuthModule,
  RbacModule,
} from '@orchestratorai/planes';
import {
  AUTH_SERVICE,
  IDENTITY_PROVIDER,
  SupabaseIdentityProvider,
} from '@orchestratorai/planes/auth';
import { SupabaseAuthService } from '@orchestratorai/planes/auth/services/supabase-auth.service';
import { InternalIdentityLinkService } from '@orchestratorai/planes/auth/services/internal-identity-link.service';
import { HealthController } from './health.controller';
import { MarketsModule } from './markets/markets.module';
import { A2AModule } from './a2a/a2a.module';
import { TournamentModule } from './tournaments/tournament.module';
import { ClubModule } from './clubs/club.module';
import { CurriculumModule } from './curriculum/curriculum.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { FirstTouchModule } from './first-touch/first-touch.module';
import { BillingModule } from './billing/billing.module';
import { PublicConfigModule } from './public-config/public-config.module';
import { CostModelingModule } from './cost-modeling/cost-modeling.module';
import { AttributionModule } from './attribution/attribution.module';
import { CredentialsModule } from './credentials/credentials.module';
import { LearningPanelModule } from './learning-panel/learning-panel.module';
import { UsersModule } from './users/users.module';
import { AuthMiddleware } from './auth/auth.middleware';
import { AuthController } from './auth/auth.controller';
import { InviteService } from './auth/invite.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../../.env'),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    ConfigProviderModule,
    AuthModule,
    RbacModule,
    LLMPlaneModule,
    ObservabilityPlaneModule,
    MarketsModule,
    A2AModule,
    TournamentModule,
    ClubModule,
    CurriculumModule,
    OnboardingModule,
    FirstTouchModule,
    BillingModule,
    PublicConfigModule,
    CostModelingModule,
    AttributionModule,
    CredentialsModule,
    LearningPanelModule,
    UsersModule,
  ],
  controllers: [HealthController, AuthController],
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: SupabaseIdentityProvider },
    InternalIdentityLinkService,
    SupabaseAuthService,
    { provide: AUTH_SERVICE, useExisting: SupabaseAuthService },
    AuthMiddleware,
    InviteService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
