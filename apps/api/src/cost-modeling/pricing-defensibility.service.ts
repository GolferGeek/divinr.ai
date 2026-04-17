import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export type ItemKind =
  | 'custom_analyst'
  | 'custom_instrument'
  | 'analyst_contract_override'
  | 'instrument_contract_override'
  | 'byo_platform_fee';

export interface DefensibilityRow {
  itemKind: ItemKind;
  avgMonthlyCostCents: number;
  currentMonthlyFeeCents: number;
  marginPct: number;
  underPricedCount: number;
  overPricedCount: number;
}

interface ItemAggregateRow {
  user_id: string;
  monthly_usd_cents: string | number;
}

interface AuthorshipUsageRow {
  total_cost_cents: string | number | null;
}

@Injectable()
export class PricingDefensibilityService {
  private readonly logger = new Logger(PricingDefensibilityService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  private envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private fallbackFeeCentsForKind(kind: ItemKind): number {
    switch (kind) {
      case 'custom_analyst': return this.envInt('ANALYST_AUTHORSHIP_USD', 60) * 100;
      case 'custom_instrument': return this.envInt('INSTRUMENT_AUTHORSHIP_USD', 20) * 100;
      case 'analyst_contract_override': return this.envInt('CONTRACT_OVERRIDE_USD', 0) * 100;
      case 'instrument_contract_override': return this.envInt('CONTRACT_OVERRIDE_USD', 0) * 100;
      case 'byo_platform_fee': return this.envInt('BYO_PLATFORM_FEE_USD', 10) * 100;
    }
  }

  async summarizeByItemKind(): Promise<DefensibilityRow[]> {
    const kinds: ItemKind[] = [
      'custom_analyst',
      'custom_instrument',
      'analyst_contract_override',
      'instrument_contract_override',
      'byo_platform_fee',
    ];

    const rows: DefensibilityRow[] = [];
    for (const kind of kinds) {
      rows.push(await this.summarizeKind(kind));
    }
    return rows;
  }

  private async summarizeKind(kind: ItemKind): Promise<DefensibilityRow> {
    const itemsResult = await this.db.rawQuery(
      `SELECT user_id, monthly_usd_cents
         FROM billing.authored_items
        WHERE item_kind = $1 AND status = 'active'`,
      [kind],
    );
    const items = (itemsResult.data as ItemAggregateRow[] | null) ?? [];

    const fallbackFee = this.fallbackFeeCentsForKind(kind);

    if (items.length === 0) {
      return {
        itemKind: kind,
        avgMonthlyCostCents: 0,
        currentMonthlyFeeCents: fallbackFee,
        marginPct: fallbackFee > 0 ? 100 : 0,
        underPricedCount: 0,
        overPricedCount: 0,
      };
    }

    const view = kind === 'custom_analyst'
      ? 'prediction.llm_usage_per_analyst_authorship_monthly'
      : kind === 'custom_instrument'
        ? 'prediction.llm_usage_per_instrument_authorship_monthly'
        : null;

    let totalCostCents = 0;
    let underPricedCount = 0;
    let overPricedCount = 0;
    let totalFeeCents = 0;

    for (const item of items) {
      const fee = Number(item.monthly_usd_cents);
      totalFeeCents += fee;

      let costCents = 0;
      if (view) {
        const usageResult = await this.db.rawQuery(
          `SELECT coalesce(avg(total_cost_cents), 0)::numeric(12,2) as total_cost_cents
             FROM ${view}
            WHERE ${kind === 'custom_analyst' ? 'analyst_author_user_id' : 'instrument_author_user_id'} = $1
              AND total_cost_cents IS NOT NULL
              AND year_month >= to_char(now() - interval '3 months', 'YYYY-MM')`,
          [item.user_id],
        );
        const rows = (usageResult.data as AuthorshipUsageRow[] | null) ?? [];
        costCents = Number(rows[0]?.total_cost_cents ?? 0);
      }

      totalCostCents += costCents;
      if (costCents > fee) underPricedCount += 1;
      if (fee > costCents * 2 && fee > 0) overPricedCount += 1;
    }

    const avgMonthlyCostCents = Math.round(totalCostCents / items.length);
    const currentMonthlyFeeCents = Math.round(totalFeeCents / items.length);
    const marginPct = currentMonthlyFeeCents > 0
      ? Number((((currentMonthlyFeeCents - avgMonthlyCostCents) / currentMonthlyFeeCents) * 100).toFixed(2))
      : 0;

    return {
      itemKind: kind,
      avgMonthlyCostCents,
      currentMonthlyFeeCents,
      marginPct,
      underPricedCount,
      overPricedCount,
    };
  }
}
