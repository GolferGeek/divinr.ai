/**
 * Unit tests for StripeService.runPriceSanityCheck — the env-vs-Stripe drift
 * warning path. Stubs the Stripe SDK client so no network calls happen.
 */
import { Logger } from '@nestjs/common';
import { BillingConfigService } from '../../src/billing/billing-config.service';
import { StripeService } from '../../src/billing/stripe.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function captureWarnings(): { warnings: string[]; restore: () => void } {
  const warnings: string[] = [];
  const original = Logger.prototype.warn;
  Logger.prototype.warn = function (this: Logger, ...args: unknown[]) {
    warnings.push(args.map(String).join(' '));
  };
  return { warnings, restore: () => { Logger.prototype.warn = original; } };
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const originals: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) originals[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

async function main() {
  console.log('\nStripeService sanity check\n');

  // Disabled mode: no client, onModuleInit logs and returns
  await withEnv({ STRIPE_SECRET_KEY: undefined }, async () => {
    const cap = captureWarnings();
    try {
      const config = new BillingConfigService();
      const svc = new StripeService(config);
      assert(svc.isEnabled() === false, 'disabled when STRIPE_SECRET_KEY unset');
      assert(svc.getClient() === null, 'no client instantiated');
      await svc.onModuleInit();
      assert(cap.warnings.length === 0, 'disabled mode emits no warnings');
    } finally { cap.restore(); }
  });

  // Enabled mode with a stubbed client: drift produces warnings, missing prices produce warnings
  await withEnv({
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    BASIC_MONTHLY_USD: '50',
    INSTRUMENT_AUTHORSHIP_USD: '20',
    ANALYST_AUTHORSHIP_USD: '60',
    BYO_PLATFORM_FEE_USD: '10',
    STUDENT_DISCOUNT_PCT: '10',
    STRIPE_PRICE_BASIC_MONTHLY: 'price_b',
    STRIPE_PRICE_INSTRUMENT_REGULAR: 'price_ir',
    STRIPE_PRICE_INSTRUMENT_STUDENT: 'price_is',
    STRIPE_PRICE_ANALYST_REGULAR: 'price_ar',
    STRIPE_PRICE_ANALYST_STUDENT: undefined, // drives the missing-price warning branch
    STRIPE_PRICE_BYO_PLATFORM_FEE: 'price_byo',
  }, async () => {
    const cap = captureWarnings();
    try {
      const config = new BillingConfigService();
      const svc = new StripeService(config);
      assert(svc.isEnabled() === true, 'enabled when STRIPE_SECRET_KEY set');

      // Inject a stub client. price_b has the right amount; price_ir is drifted by 1c;
      // price_byo throws on retrieve to exercise the catch path.
      const stub = {
        prices: {
          retrieve: async (id: string) => {
            if (id === 'price_b') return { unit_amount: 5000 } as any;
            if (id === 'price_ir') return { unit_amount: 1999 } as any; // drift!
            if (id === 'price_is') return { unit_amount: 200 } as any;
            if (id === 'price_ar') return { unit_amount: 6000 } as any;
            if (id === 'price_byo') throw new Error('network kaboom');
            throw new Error('unexpected price id ' + id);
          },
        },
      };
      (svc as any).client = stub;

      await svc.runPriceSanityCheck();

      const drift = cap.warnings.find((w) => w.includes('STRIPE_PRICE_INSTRUMENT_REGULAR') && w.includes('drift'));
      assert(!!drift, 'drift detected on STRIPE_PRICE_INSTRUMENT_REGULAR (1999c vs 2000c)');
      const missing = cap.warnings.find((w) => w.includes('STRIPE_PRICE_ANALYST_STUDENT') && w.includes('not set'));
      assert(!!missing, 'missing price id surfaces a "not set" warning');
      const retrieveErr = cap.warnings.find((w) => w.includes('STRIPE_PRICE_BYO_PLATFORM_FEE') && w.includes('failed'));
      assert(!!retrieveErr, 'retrieve failure logs but does not throw');
    } finally { cap.restore(); }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
