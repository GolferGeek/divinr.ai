/**
 * One-shot billing migration CLI.
 *
 * Inserts a `trial` subscription row (+ `subscription_events` audit row with
 * reason='migration_backfill') for every `authz.users` row that does not yet
 * have a matching `billing.subscriptions` row. Idempotent — subsequent runs
 * skip rows that already exist.
 *
 * Run with:
 *   pnpm --filter @divinr/api exec tsx apps/api/scripts/migrate-billing-backfill.ts
 */

import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';

loadEnv({ path: join(__dirname, '..', '..', '..', '.env') });
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:7011/postgres';
process.env.DB_PROVIDER = process.env.DB_PROVIDER || 'supabase';
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'simplified';
process.env.OBSERVABILITY_PROVIDER = process.env.OBSERVABILITY_PROVIDER || 'supabase';
process.env.CONFIG_PROVIDER = process.env.CONFIG_PROVIDER || 'local';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/billing/billing.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const billing = app.get(BillingService);
    const started = Date.now();
    const result = await billing.migrateBackfillSubscriptions();
    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    console.log('migrate-billing-backfill summary:');
    console.log(`  inserted: ${result.inserted_count}`);
    console.log(`  skipped:  ${result.skipped_count}`);
    console.log(`  errors:   ${result.errors.length}`);
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.error(`    - ${e.userId}: ${e.error}`);
      }
    }
    console.log(`  elapsed:  ${elapsed}s`);
    process.exitCode = result.errors.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('migrate-billing-backfill failed:', err);
  process.exit(1);
});
