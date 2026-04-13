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
