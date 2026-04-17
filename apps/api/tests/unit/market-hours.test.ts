/**
 * Unit tests for MarketHoursService — Phase 2 of live-prediction-pnl.
 * Verifies the US equity market-hours gate (14:30–21:00 UTC Mon–Fri)
 * and the DAY_TRADER_IGNORE_MARKET_HOURS override.
 */
import { MarketHoursService } from '../../src/markets/services/market-hours.service';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function utc(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
}

async function main(): Promise<void> {
  console.log('MarketHoursService.isUsEquityMarketOpen');

  const svc = new MarketHoursService();

  // Sanity: 2026-04-17 is a Friday; 2026-04-18 is Saturday; 2026-04-19 is Sunday; 2026-04-20 is Monday.
  const saturday = utc(2026, 4, 18, 15, 0);
  const sunday = utc(2026, 4, 19, 15, 0);
  assert(!svc.isUsEquityMarketOpen(saturday), 'Saturday 15:00 UTC → closed');
  assert(!svc.isUsEquityMarketOpen(sunday), 'Sunday 15:00 UTC → closed');

  const monday1429 = utc(2026, 4, 20, 14, 29);
  const monday1430 = utc(2026, 4, 20, 14, 30);
  const monday2059 = utc(2026, 4, 20, 20, 59);
  const monday2100 = utc(2026, 4, 20, 21, 0);
  assert(!svc.isUsEquityMarketOpen(monday1429), 'Monday 14:29 UTC → closed');
  assert(svc.isUsEquityMarketOpen(monday1430), 'Monday 14:30 UTC → open');
  assert(svc.isUsEquityMarketOpen(monday2059), 'Monday 20:59 UTC → open');
  assert(!svc.isUsEquityMarketOpen(monday2100), 'Monday 21:00 UTC → closed');

  // Env override.
  const prior = process.env.DAY_TRADER_IGNORE_MARKET_HOURS;
  process.env.DAY_TRADER_IGNORE_MARKET_HOURS = 'true';
  try {
    const saturday3am = utc(2026, 4, 18, 3, 0);
    assert(svc.isUsEquityMarketOpen(saturday3am), 'env override forces true on Saturday 03:00 UTC');
  } finally {
    if (prior === undefined) delete process.env.DAY_TRADER_IGNORE_MARKET_HOURS;
    else process.env.DAY_TRADER_IGNORE_MARKET_HOURS = prior;
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
