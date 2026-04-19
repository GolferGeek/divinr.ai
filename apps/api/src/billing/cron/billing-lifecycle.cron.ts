import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingService } from '../billing.service';

@Injectable()
export class BillingLifecycleCron {
  private readonly logger = new Logger(BillingLifecycleCron.name);

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
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
}
