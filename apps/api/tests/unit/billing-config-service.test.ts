/**
 * Unit tests for BillingConfigService.
 *
 * Verifies env-var parsing, default fallbacks, isStripeEnabled() toggling,
 * decimal-USD → cents conversion, and the priceForKind / regularEquivalent
 * helpers used by Phase 3+ flows.
 */
import { BillingConfigService } from '../../src/billing/billing-config.service';

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

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const originals: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) originals[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function main() {
  console.log('\nBillingConfigService\n');

  // isStripeEnabled toggles on STRIPE_SECRET_KEY presence
  withEnv({ STRIPE_SECRET_KEY: undefined }, () => {
    const c = new BillingConfigService();
    assert(c.isStripeEnabled() === false, 'isStripeEnabled() === false when STRIPE_SECRET_KEY unset');
  });
  withEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' }, () => {
    const c = new BillingConfigService();
    assert(c.isStripeEnabled() === true, 'isStripeEnabled() === true when STRIPE_SECRET_KEY set');
    assert(c.stripeSecretKey === 'sk_test_xxx', 'stripeSecretKey returns the env value');
  });

  // Default pricing fallbacks
  withEnv({
    BASIC_MONTHLY_USD: undefined,
    INSTRUMENT_AUTHORSHIP_USD: undefined,
    ANALYST_AUTHORSHIP_USD: undefined,
    BYO_PLATFORM_FEE_USD: undefined,
    STUDENT_DISCOUNT_PCT: undefined,
    TRIAL_DAYS: undefined,
    DORMANCY_MONTHS_BEFORE_PURGE: undefined,
  }, () => {
    const c = new BillingConfigService();
    assert(c.basicMonthlyUsdCents === 5000, 'BASIC_MONTHLY_USD default = $50 (5000c)');
    assert(c.instrumentAuthorshipUsdCents === 2000, 'INSTRUMENT_AUTHORSHIP_USD default = $20 (2000c)');
    assert(c.analystAuthorshipUsdCents === 6000, 'ANALYST_AUTHORSHIP_USD default = $60 (6000c)');
    assert(c.byoPlatformFeeUsdCents === 1000, 'BYO_PLATFORM_FEE_USD default = $10 (1000c)');
    assert(c.studentPriceFractionPct === 10, 'STUDENT_DISCOUNT_PCT default = 10 (i.e. student pays 10% of regular)');
    assert(c.trialDays === 30, 'TRIAL_DAYS default = 30');
    assert(c.dormancyMonthsBeforePurge === 6, 'DORMANCY_MONTHS_BEFORE_PURGE default = 6');
  });

  // Decimal-USD → cents conversion
  withEnv({ BASIC_MONTHLY_USD: '49.99' }, () => {
    const c = new BillingConfigService();
    assert(c.basicMonthlyUsdCents === 4999, '49.99 USD → 4999 cents');
  });
  withEnv({ INSTRUMENT_AUTHORSHIP_USD: '0.50' }, () => {
    const c = new BillingConfigService();
    assert(c.instrumentAuthorshipUsdCents === 50, '0.50 USD → 50 cents');
  });

  // Invalid USD value falls back to default
  withEnv({ BASIC_MONTHLY_USD: 'not-a-number' }, () => {
    const c = new BillingConfigService();
    // Suppress the warning log for this assertion only
    assert(c.basicMonthlyUsdCents === 5000, 'invalid USD env value falls back to default $50');
  });

  // STUDENT_EDU_ALLOWED_DOMAINS parsing (comma-split, trim, lowercase)
  withEnv({ STUDENT_EDU_ALLOWED_DOMAINS: undefined }, () => {
    const c = new BillingConfigService();
    assert(JSON.stringify(c.studentEduAllowedDomains) === JSON.stringify(['edu']), 'default allowlist is [edu]');
  });
  withEnv({ STUDENT_EDU_ALLOWED_DOMAINS: 'edu, ac.uk , ED.AU' }, () => {
    const c = new BillingConfigService();
    assert(JSON.stringify(c.studentEduAllowedDomains) === JSON.stringify(['edu', 'ac.uk', 'ed.au']), 'allowlist trims + lowercases');
  });

  // priceForKind: kind × isStudent → correct env var
  withEnv({
    STRIPE_PRICE_INSTRUMENT_REGULAR: 'price_inst_r',
    STRIPE_PRICE_INSTRUMENT_STUDENT: 'price_inst_s',
    STRIPE_PRICE_ANALYST_REGULAR: 'price_ana_r',
    STRIPE_PRICE_ANALYST_STUDENT: 'price_ana_s',
  }, () => {
    const c = new BillingConfigService();
    assert(c.priceForKind('custom_instrument', false) === 'price_inst_r', 'priceForKind(instrument, regular)');
    assert(c.priceForKind('custom_instrument', true) === 'price_inst_s', 'priceForKind(instrument, student)');
    assert(c.priceForKind('custom_analyst', false) === 'price_ana_r', 'priceForKind(analyst, regular)');
    assert(c.priceForKind('custom_analyst', true) === 'price_ana_s', 'priceForKind(analyst, student)');
  });

  // regularEquivalent: student price → regular price
  withEnv({
    STRIPE_PRICE_INSTRUMENT_REGULAR: 'price_inst_r',
    STRIPE_PRICE_INSTRUMENT_STUDENT: 'price_inst_s',
    STRIPE_PRICE_ANALYST_REGULAR: 'price_ana_r',
    STRIPE_PRICE_ANALYST_STUDENT: 'price_ana_s',
  }, () => {
    const c = new BillingConfigService();
    assert(c.regularEquivalent('price_inst_s') === 'price_inst_r', 'regularEquivalent(instrument_student) = instrument_regular');
    assert(c.regularEquivalent('price_ana_s') === 'price_ana_r', 'regularEquivalent(analyst_student) = analyst_regular');
    let threw = false;
    try { c.regularEquivalent('price_unknown'); } catch { threw = true; }
    assert(threw, 'regularEquivalent(unknown) throws');
  });

  // pricingPairs surfaces every (env, expected, priceId) tuple
  withEnv({
    BASIC_MONTHLY_USD: '50',
    INSTRUMENT_AUTHORSHIP_USD: '20',
    ANALYST_AUTHORSHIP_USD: '60',
    BYO_PLATFORM_FEE_USD: '10',
    STUDENT_DISCOUNT_PCT: '10',
    STRIPE_PRICE_BASIC_MONTHLY: 'price_b',
    STRIPE_PRICE_INSTRUMENT_REGULAR: 'price_ir',
    STRIPE_PRICE_INSTRUMENT_STUDENT: 'price_is',
    STRIPE_PRICE_ANALYST_REGULAR: 'price_ar',
    STRIPE_PRICE_ANALYST_STUDENT: 'price_as',
    STRIPE_PRICE_BYO_PLATFORM_FEE: 'price_byo',
  }, () => {
    const c = new BillingConfigService();
    const pairs = c.pricingPairs();
    assert(pairs.length === 6, 'pricingPairs returns 6 entries');
    const basic = pairs.find((p) => p.envName === 'STRIPE_PRICE_BASIC_MONTHLY');
    assert(basic?.expectedCents === 5000 && basic?.priceId === 'price_b', 'basic_monthly pair shape');
    const instStudent = pairs.find((p) => p.envName === 'STRIPE_PRICE_INSTRUMENT_STUDENT');
    assert(instStudent?.expectedCents === 200, 'instrument_student expected = 10% × $20 = 200c');
    const anaStudent = pairs.find((p) => p.envName === 'STRIPE_PRICE_ANALYST_STUDENT');
    assert(anaStudent?.expectedCents === 600, 'analyst_student expected = 10% × $60 = 600c');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
