import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import {
  DatabaseModule,
  LLMPlaneModule,
  ObservabilityPlaneModule,
  ConfigProviderModule,
  AuthModule,
  RbacModule,
} from '@orchestratorai/planes';
import {
  IDENTITY_PROVIDER,
  SupabaseIdentityProvider,
} from '@orchestratorai/planes/auth';
import { HealthController } from './health.controller';
import { MarketsModule } from './markets/markets.module';
import { AuthMiddleware } from './auth/auth.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    ConfigProviderModule,
    AuthModule,
    RbacModule,
    LLMPlaneModule,
    ObservabilityPlaneModule,
    MarketsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: SupabaseIdentityProvider },
    AuthMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
