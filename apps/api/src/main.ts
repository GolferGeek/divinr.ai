import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Preload env before NestJS bootstrap so process.env is populated
config({ path: resolve(__dirname, '../../../../scripts/.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT || 6100);
  await app.listen(port);
  console.log(`Divinr API listening on port ${port}`);
}

void bootstrap();
