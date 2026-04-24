import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { BillingService } from '../billing.service';
import { BillingConfigService } from '../billing-config.service';
import { StripeService } from '../stripe.service';

@Injectable()
export class BillingLifecycleCron {
  private readonly logger = new Logger(BillingLifecycleCron.name);

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(BillingConfigService) private readonly config: BillingConfigService,
    @Inject(StripeService) private readonly stripeSvc: StripeService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  /** Hourly — trial rows past trial_ends_at flip to canceled. */
  @Cron('0 * * * *')
  async trialExpiryTick(): Promise<void> {
    if (process.env.BILLING_DISABLE_LIFECYCLE_CRON === 'true') return;
    try {
      await this.billing.computeLifecycleTransitions();
    } catch (err) {
      this.logger.error(`trialExpiryTick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Daily at 06:00 UTC — 30-day purge warnings + purge emission. */
  @Cron('0 6 * * *')
  async purgeTick(): Promise<void> {
    if (process.env.BILLING_DISABLE_LIFECYCLE_CRON === 'true') return;
    try {
      await this.billing.computePurgeCandidates();
    } catch (err) {
      this.logger.error(`purgeTick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Daily at 03:00 UTC — re-verify .edu students.
   *
   * For each user with `is_student=true`, check whether `edu_email`'s domain
   * still matches `STUDENT_EDU_ALLOWED_DOMAINS`:
   *  - Match → bump `edu_last_verified_at = now()`.
   *  - No match → flip `is_student=false`, walk the user's Stripe subscription
   *    items, swap each student-Price line for the regular equivalent (via
   *    stripe.subscriptionItems.update with create_prorations), append a
   *    Basic Monthly line if not already present, and write a notification
   *    row so the user knows their pricing changed.
   *
   * PRD §8 Phase 4 specified "monthly" — running daily is strictly better
   * (idempotent re-checks, faster drift detection, and simpler cron config).
   * The query is cheap; only flagged students are walked.
   */
  @Cron('0 3 * * *')
  async eduReverifyTick(): Promise<void> {
    if (process.env.BILLING_DISABLE_LIFECYCLE_CRON === 'true') return;
    try {
      await this.reverifyStudents();
    } catch (err) {
      this.logger.error(`eduReverifyTick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Public so the admin endpoint POST /admin/billing/run-cron/edu-reverify can
   * trigger it on demand (used by Phase 4 spec student-lapse.spec.ts).
   * Returns counts so the caller can render a meaningful response.
   */
  async reverifyStudents(): Promise<{ ranAt: string; usersChecked: number; usersFlippedToRegular: number }> {
    const ranAt = new Date().toISOString();
    let usersChecked = 0;
    let usersFlippedToRegular = 0;

    const result = await this.db.rawQuery(
      `SELECT id, edu_email FROM authz.users WHERE is_student = true`,
      [],
    );
    if (result.error) throw new Error(`reverifyStudents user query failed: ${result.error.message}`);
    const rows = (result.data as Array<{ id: string; edu_email: string | null }> | null) ?? [];
    const allowedSuffixes = this.config.studentEduAllowedDomains;

    for (const row of rows) {
      usersChecked++;
      const email = row.edu_email ?? '';
      if (matchesEduDomain(email, allowedSuffixes)) {
        await this.db.rawQuery(
          `UPDATE authz.users SET edu_last_verified_at = $2 WHERE id = $1`,
          [row.id, ranAt],
        );
        continue;
      }
      // Lapsed: flip the flag, swap Stripe Prices, attach Basic.
      try {
        await this.handleStudentLapse(row.id);
        usersFlippedToRegular++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`student lapse handling failed for ${row.id}: ${msg}`);
      }
    }
    this.logger.log(`reverifyStudents: ranAt=${ranAt} checked=${usersChecked} flipped=${usersFlippedToRegular}`);
    return { ranAt, usersChecked, usersFlippedToRegular };
  }

  private async handleStudentLapse(userId: string): Promise<void> {
    // 1. Flip the flag immediately so subsequent addAuthoredItem calls route
    //    through the regular Price branch even if Stripe re-pricing partially
    //    fails.
    await this.db.rawQuery(
      `UPDATE authz.users SET is_student = false WHERE id = $1`,
      [userId],
    );

    if (!this.stripeSvc.isEnabled()) return;
    const sub = await this.billing.getSubscription(userId);
    if (!sub?.stripe_subscription_id) {
      this.logger.log(`student lapse: ${userId} has no Stripe subscription; flag-only flip`);
      await this.tryInsertNotification(userId, 'edu_lapsed', 'Your .edu status lapsed — your authored content will be billed at regular rates.');
      return;
    }

    const client = this.stripeSvc.getClient();
    if (!client) return;

    const fullSub = await client.subscriptions.retrieve(sub.stripe_subscription_id);
    const items = fullSub.items?.data ?? [];

    // 2. Swap any student-Price item to its regular equivalent.
    const studentPriceIds = new Set([
      this.config.stripePriceInstrumentStudent,
      this.config.stripePriceAnalystStudent,
    ].filter((p): p is string => !!p));

    for (const item of items) {
      const itemPriceId = item.price?.id;
      if (!itemPriceId || !studentPriceIds.has(itemPriceId) || !item.id) continue;
      try {
        const newPriceId = this.config.regularEquivalent(itemPriceId);
        await this.stripeSvc.updateSubscriptionItemPrice({
          subscriptionItemId: item.id,
          newPriceId,
          idempotencyKey: `edu_lapse:${userId}:${item.id}`,
        });
        await this.db.rawQuery(
          `UPDATE billing.authored_items SET stripe_price_id = $2 WHERE stripe_subscription_item_id = $1`,
          [item.id, newPriceId],
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`student lapse: updateSubscriptionItemPrice failed for ${item.id}: ${msg}`);
      }
    }

    // 3. Attach Basic Monthly if not already present.
    const basicPriceId = this.config.stripePriceBasicMonthly;
    if (basicPriceId) {
      const hasBasic = items.some((i) => i.price?.id === basicPriceId);
      if (!hasBasic) {
        try {
          await this.stripeSvc.addSubscriptionItem({
            subscriptionId: sub.stripe_subscription_id,
            priceId: basicPriceId,
            idempotencyKey: `edu_lapse:${userId}:basic`,
            metadata: { userId, source: 'edu_lapse' },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`student lapse: addSubscriptionItem(basic) failed for ${userId}: ${msg}`);
        }
      }
    }

    await this.tryInsertNotification(userId, 'edu_lapsed', 'Your .edu status lapsed — your authored content + Basic subscription will be billed at regular rates next cycle.');
  }

  private async tryInsertNotification(userId: string, kind: string, message: string): Promise<void> {
    try {
      await this.db.rawQuery(
        `INSERT INTO notify.notifications (user_id, kind, message)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, kind, message],
      );
    } catch (err) {
      this.logger.debug(`notify.notifications insert skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function matchesEduDomain(email: string, allowedSuffixes: string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  for (const suffix of allowedSuffixes) {
    const s = suffix.toLowerCase().replace(/^\./, '');
    if (domain === s || domain.endsWith('.' + s)) return true;
  }
  return false;
}
