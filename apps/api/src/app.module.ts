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
  IDENTITY_PROVIDER,
  SupabaseIdentityProvider,
} from '@orchestratorai/planes/auth';
import { HealthController } from './health.controller';
import { MarketsModule } from './markets/markets.module';
import { A2AModule } from './a2a/a2a.module';
import { AuthMiddleware } from './auth/auth.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../../scripts/.env'),
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
