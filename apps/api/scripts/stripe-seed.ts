/**
 * One-shot Stripe seed CLI.
 *
 * Reads BASIC_MONTHLY_USD / INSTRUMENT_AUTHORSHIP_USD / ANALYST_AUTHORSHIP_USD /
 * BYO_PLATFORM_FEE_USD / STUDENT_DISCOUNT_PCT from env, then idempotently
 * creates the corresponding Stripe Products and Prices, identified by stable
 * lookup keys so reruns are no-ops:
 *
 *   basic_monthly         instrument_regular     instrument_student
 *   analyst_regular       analyst_student        byo_platform_fee
 *
 * On completion, prints `STRIPE_PRICE_*=price_xxx` and `STRIPE_PRODUCT_*=prod_xxx`
 * lines for the operator to paste into the API .env.
 *
 * Run with:
 *   pnpm --filter @divinr/api exec tsx apps/api/scripts/stripe-seed.ts
 *
 * Requires STRIPE_SECRET_KEY in env (sk_test_* for test mode, sk_live_* for prod).
 */

import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import Stripe from 'stripe';

loadEnv({ path: join(__dirname, '..', '..', '..', '.env') });

interface SeedTarget {
  productLookup: string;
  productName: string;
  productEnvVar: string;
  priceLookup: string;
  priceEnvVar: string;
  unitAmountCents: number;
  recurring: { interval: 'month' };
  metadata: Record<string, string>;
}

function usdToCents(raw: string | undefined, defaultUsd: number): number {
  const n = raw === undefined ? defaultUsd : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Math.round(defaultUsd * 100);
}

function buildTargets(): SeedTarget[] {
  const basicCents = usdToCents(process.env.BASIC_MONTHLY_USD, 50);
  const instrumentCents = usdToCents(process.env.INSTRUMENT_AUTHORSHIP_USD, 20);
  const analystCents = usdToCents(process.env.ANALYST_AUTHORSHIP_USD, 60);
  const byoCents = usdToCents(process.env.BYO_PLATFORM_FEE_USD, 10);
  const studentPct = Number(process.env.STUDENT_DISCOUNT_PCT ?? '10') / 100;

  return [
    {
      productLookup: 'divinr_basic',
      productName: 'Divinr Basic',
      productEnvVar: 'STRIPE_PRODUCT_BASIC',
      priceLookup: 'basic_monthly',
      priceEnvVar: 'STRIPE_PRICE_BASIC_MONTHLY',
      unitAmountCents: basicCents,
      recurring: { interval: 'month' },
      metadata: { plan: 'basic' },
    },
    {
      productLookup: 'divinr_instrument',
      productName: 'Divinr Authored Instrument',
      productEnvVar: 'STRIPE_PRODUCT_INSTRUMENT',
      priceLookup: 'instrument_regular',
      priceEnvVar: 'STRIPE_PRICE_INSTRUMENT_REGULAR',
      unitAmountCents: instrumentCents,
      recurring: { interval: 'month' },
      metadata: { kind: 'custom_instrument', tier: 'regular' },
    },
    {
      productLookup: 'divinr_instrument',
      productName: 'Divinr Authored Instrument',
      productEnvVar: 'STRIPE_PRODUCT_INSTRUMENT',
      priceLookup: 'instrument_student',
      priceEnvVar: 'STRIPE_PRICE_INSTRUMENT_STUDENT',
      unitAmountCents: Math.round(instrumentCents * studentPct),
      recurring: { interval: 'month' },
      metadata: { kind: 'custom_instrument', tier: 'student' },
    },
    {
      productLookup: 'divinr_analyst',
      productName: 'Divinr Authored Analyst',
      productEnvVar: 'STRIPE_PRODUCT_ANALYST',
      priceLookup: 'analyst_regular',
      priceEnvVar: 'STRIPE_PRICE_ANALYST_REGULAR',
      unitAmountCents: analystCents,
      recurring: { interval: 'month' },
      metadata: { kind: 'custom_analyst', tier: 'regular' },
    },
    {
      productLookup: 'divinr_analyst',
      productName: 'Divinr Authored Analyst',
      productEnvVar: 'STRIPE_PRODUCT_ANALYST',
      priceLookup: 'analyst_student',
      priceEnvVar: 'STRIPE_PRICE_ANALYST_STUDENT',
      unitAmountCents: Math.round(analystCents * studentPct),
      recurring: { interval: 'month' },
      metadata: { kind: 'custom_analyst', tier: 'student' },
    },
    {
      productLookup: 'divinr_byo',
      productName: 'Divinr BYO Platform Fee',
      productEnvVar: 'STRIPE_PRODUCT_BYO',
      priceLookup: 'byo_platform_fee',
      priceEnvVar: 'STRIPE_PRICE_BYO_PLATFORM_FEE',
      unitAmountCents: byoCents,
      recurring: { interval: 'month' },
      metadata: { kind: 'byo_platform_fee' },
    },
  ];
}

async function ensureProduct(client: Stripe, lookup: string, name: string): Promise<string> {
  const search = await client.products.search({ query: `metadata['lookup_key']:'${lookup}'`, limit: 1 });
  if (search.data.length > 0) return search.data[0].id;
  const created = await client.products.create({
    name,
    metadata: { lookup_key: lookup },
  });
  return created.id;
}

async function ensurePrice(
  client: Stripe,
  productId: string,
  target: SeedTarget,
): Promise<string> {
  const list = await client.prices.list({ lookup_keys: [target.priceLookup], active: true, limit: 1 });
  if (list.data.length > 0) return list.data[0].id;
  const created = await client.prices.create({
    product: productId,
    unit_amount: target.unitAmountCents,
    currency: 'usd',
    recurring: target.recurring,
    lookup_key: target.priceLookup,
    metadata: target.metadata,
  });
  return created.id;
}

async function main(): Promise<void> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error('STRIPE_SECRET_KEY not set; aborting');
    process.exit(1);
  }
  const client = new Stripe(secret, {
    apiVersion: (process.env.STRIPE_API_VERSION ?? '2025-04-30.basil') as Stripe.StripeConfig['apiVersion'],
  });

  const targets = buildTargets();
  const env: Record<string, string> = {};

  // Group by productLookup so we only ensure each product once.
  const productIds = new Map<string, string>();
  for (const t of targets) {
    if (!productIds.has(t.productLookup)) {
      const pid = await ensureProduct(client, t.productLookup, t.productName);
      productIds.set(t.productLookup, pid);
      env[t.productEnvVar] = pid;
      console.error(`product ${t.productLookup} → ${pid}`);
    }
  }
  for (const t of targets) {
    const pid = productIds.get(t.productLookup)!;
    const priceId = await ensurePrice(client, pid, t);
    env[t.priceEnvVar] = priceId;
    console.error(`price   ${t.priceLookup}=${t.unitAmountCents}c → ${priceId}`);
  }

  console.log('\n# Paste into apps/api/.env (or your prod env):');
  for (const [k, v] of Object.entries(env)) {
    console.log(`${k}=${v}`);
  }
}

main().catch((err) => {
  console.error('stripe-seed failed:', err);
  process.exit(1);
});
