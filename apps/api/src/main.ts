import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Preload env before NestJS bootstrap so process.env is populated
config({ path: resolve(__dirname, '../../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:7101'] });
  const port = Number(process.env.PORT || 7100);
  await app.listen(port);
  console.log(`Divinr API listening on port ${port}`);
}

void bootstrap();
