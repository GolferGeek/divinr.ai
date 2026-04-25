import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class BillingConfigService {
  private readonly logger = new Logger(BillingConfigService.name);

  isStripeEnabled(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  get stripeSecretKey(): string | null {
    return process.env.STRIPE_SECRET_KEY ?? null;
  }

  get stripePublishableKey(): string | null {
    return process.env.STRIPE_PUBLISHABLE_KEY ?? null;
  }

  get stripeWebhookSecret(): string | null {
    return process.env.STRIPE_WEBHOOK_SECRET ?? null;
  }

  get stripeApiVersion(): string {
    return process.env.STRIPE_API_VERSION ?? '2025-04-30.basil';
  }

  get stripeProductBasic(): string | null {
    return process.env.STRIPE_PRODUCT_BASIC ?? null;
  }

  get stripePriceBasicMonthly(): string | null {
    return process.env.STRIPE_PRICE_BASIC_MONTHLY ?? null;
  }

  get stripeProductInstrument(): string | null {
    return process.env.STRIPE_PRODUCT_INSTRUMENT ?? null;
  }

  get stripePriceInstrumentRegular(): string | null {
    return process.env.STRIPE_PRICE_INSTRUMENT_REGULAR ?? null;
  }

  get stripePriceInstrumentStudent(): string | null {
    return process.env.STRIPE_PRICE_INSTRUMENT_STUDENT ?? null;
  }

  get stripeProductAnalyst(): string | null {
    return process.env.STRIPE_PRODUCT_ANALYST ?? null;
  }

  get stripePriceAnalystRegular(): string | null {
    return process.env.STRIPE_PRICE_ANALYST_REGULAR ?? null;
  }

  get stripePriceAnalystStudent(): string | null {
    return process.env.STRIPE_PRICE_ANALYST_STUDENT ?? null;
  }

  get stripeProductByo(): string | null {
    return process.env.STRIPE_PRODUCT_BYO ?? null;
  }

  get stripePriceByoPlatformFee(): string | null {
    return process.env.STRIPE_PRICE_BYO_PLATFORM_FEE ?? null;
  }

  get basicMonthlyUsdCents(): number {
    return this.parseUsdToCents(process.env.BASIC_MONTHLY_USD, 50);
  }

  get instrumentAuthorshipUsdCents(): number {
    return this.parseUsdToCents(process.env.INSTRUMENT_AUTHORSHIP_USD, 20);
  }

  get analystAuthorshipUsdCents(): number {
    return this.parseUsdToCents(process.env.ANALYST_AUTHORSHIP_USD, 60);
  }

  get byoPlatformFeeUsdCents(): number {
    return this.parseUsdToCents(process.env.BYO_PLATFORM_FEE_USD, 10);
  }

  /**
   * Fraction (as a percentage) of regular per-item price that students pay.
   * Default 10 means students pay 10% of regular — i.e. 90% off, $2/instrument
   * vs $20 regular. Despite the env-var name `STUDENT_DISCOUNT_PCT`, the value
   * is the price-fraction the student pays, not the discount applied.
   */
  get studentPriceFractionPct(): number {
    const raw = process.env.STUDENT_DISCOUNT_PCT;
    if (!raw) return 10;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 10;
  }

  get trialDays(): number {
    const raw = process.env.TRIAL_DAYS;
    if (!raw) return 30;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  }

  get dormancyMonthsBeforePurge(): number {
    const raw = process.env.DORMANCY_MONTHS_BEFORE_PURGE;
    if (!raw) return 6;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
  }

  get studentEduAllowedDomains(): string[] {
    const raw = process.env.STUDENT_EDU_ALLOWED_DOMAINS ?? 'edu';
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  }

  /**
   * Maps an authored-item kind ('custom_instrument' | 'custom_analyst') and student flag
   * to the Stripe Price id to use. Returns null if Stripe isn't configured.
   */
  priceForKind(kind: 'custom_instrument' | 'custom_analyst', isStudent: boolean): string | null {
    if (kind === 'custom_instrument') {
      return isStudent ? this.stripePriceInstrumentStudent : this.stripePriceInstrumentRegular;
    }
    return isStudent ? this.stripePriceAnalystStudent : this.stripePriceAnalystRegular;
  }

  /**
   * Inverse of priceForKind for the .edu-lapse re-pricing path: student Price id → regular equivalent.
   * Throws on unknown input so a caller bug surfaces immediately.
   */
  regularEquivalent(studentPriceId: string): string {
    if (studentPriceId === this.stripePriceInstrumentStudent) {
      const regular = this.stripePriceInstrumentRegular;
      if (!regular) throw new Error('STRIPE_PRICE_INSTRUMENT_REGULAR not set');
      return regular;
    }
    if (studentPriceId === this.stripePriceAnalystStudent) {
      const regular = this.stripePriceAnalystRegular;
      if (!regular) throw new Error('STRIPE_PRICE_ANALYST_REGULAR not set');
      return regular;
    }
    throw new Error(`No regular equivalent for student price id: ${studentPriceId}`);
  }

  /**
   * Yields [envVar, expectedCents, priceId] tuples for every (PRICE_ID, USD env var) pair we own.
   * StripeService.onModuleInit walks this to drift-check Stripe-side amounts against ours.
   */
  pricingPairs(): Array<{ envName: string; expectedCents: number; priceId: string | null }> {
    return [
      { envName: 'STRIPE_PRICE_BASIC_MONTHLY', expectedCents: this.basicMonthlyUsdCents, priceId: this.stripePriceBasicMonthly },
      { envName: 'STRIPE_PRICE_INSTRUMENT_REGULAR', expectedCents: this.instrumentAuthorshipUsdCents, priceId: this.stripePriceInstrumentRegular },
      { envName: 'STRIPE_PRICE_INSTRUMENT_STUDENT', expectedCents: Math.round(this.instrumentAuthorshipUsdCents * (this.studentPriceFractionPct / 100)), priceId: this.stripePriceInstrumentStudent },
      { envName: 'STRIPE_PRICE_ANALYST_REGULAR', expectedCents: this.analystAuthorshipUsdCents, priceId: this.stripePriceAnalystRegular },
      { envName: 'STRIPE_PRICE_ANALYST_STUDENT', expectedCents: Math.round(this.analystAuthorshipUsdCents * (this.studentPriceFractionPct / 100)), priceId: this.stripePriceAnalystStudent },
      { envName: 'STRIPE_PRICE_BYO_PLATFORM_FEE', expectedCents: this.byoPlatformFeeUsdCents, priceId: this.stripePriceByoPlatformFee },
    ];
  }

  private parseUsdToCents(raw: string | undefined, defaultUsd: number): number {
    const n = raw === undefined ? defaultUsd : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      this.logger.warn(`Invalid USD env value: '${raw}', falling back to default ${defaultUsd}`);
      return Math.round(defaultUsd * 100);
    }
    return Math.round(n * 100);
  }
}
