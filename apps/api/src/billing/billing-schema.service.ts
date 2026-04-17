import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class BillingSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(BillingSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    const ddl = `
      CREATE SCHEMA IF NOT EXISTS billing;

      CREATE TABLE IF NOT EXISTS billing.subscriptions (
        user_id text PRIMARY KEY,
        stripe_customer_id text,
        stripe_subscription_id text,
        status text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'dormant')) DEFAULT 'trial',
        trial_started_at timestamptz,
        trial_ends_at timestamptz,
        current_period_end timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS billing.authored_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        item_kind text NOT NULL CHECK (item_kind IN ('custom_analyst', 'custom_instrument', 'analyst_contract_override', 'instrument_contract_override', 'byo_platform_fee')),
        item_id text,
        monthly_usd_cents integer NOT NULL,
        stripe_subscription_item_id text,
        status text NOT NULL CHECK (status IN ('active', 'canceled', 'pending_payment')) DEFAULT 'active',
        activated_at timestamptz NOT NULL DEFAULT now(),
        canceled_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS billing_authored_items_user_status_idx ON billing.authored_items (user_id, status);
      CREATE INDEX IF NOT EXISTS billing_authored_items_kind_item_idx ON billing.authored_items (item_kind, item_id);

      CREATE TABLE IF NOT EXISTS billing.invoice_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        stripe_invoice_id text,
        period_start timestamptz NOT NULL,
        period_end timestamptz NOT NULL,
        line_items jsonb NOT NULL DEFAULT '[]',
        total_cents integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'draft',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `;
    const result = await this.db.rawQuery(ddl);
    if (result.error) throw new Error(`Billing schema creation failed: ${result.error.message}`);
    this.schemaReady = true;
    this.logger.log('Billing schema ready');
  }
}
