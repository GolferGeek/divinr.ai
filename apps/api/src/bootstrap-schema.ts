import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SchemaBootstrapService } from './bootstrap/schema-bootstrap.service';
import { SchemaReadinessService } from './bootstrap/schema-readiness.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const bootstrap = app.get(SchemaBootstrapService);
    const readiness = app.get(SchemaReadinessService);
    const results = await bootstrap.runAll();
    await readiness.assertReady();
    console.log(`Schema bootstrap complete: ${results.map((result) => result.key).join(', ')}`);
  } finally {
    await app.close();
  }
}

void main();
