import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Preload env before NestJS bootstrap so process.env is populated
config({ path: resolve(__dirname, '../../../../.env') });

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true populates req.rawBody as a Buffer alongside the parsed
  // JSON body. The Stripe webhook handler reads req.rawBody so signature
  // verification gets the unmodified bytes Stripe signed. Other routes
  // continue to receive parsed JSON exactly as before.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.enableCors({ origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:7101'] });
  const port = Number(process.env.PORT || 7100);
  await app.listen(port);
  console.log(`Divinr API listening on port ${port}`);
}

void bootstrap();
