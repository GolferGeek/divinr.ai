/**
 * Unit tests for MarketHoursService — live-prediction-pnl.
 * The gate is DST-aware (America/New_York 9:30 ≤ now < 16:00 Mon–Fri).
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

  // 2026-04-18 Saturday / 2026-04-19 Sunday — weekend rejects regardless of time.
  assert(!svc.isUsEquityMarketOpen(utc(2026, 4, 18, 15, 0)), 'Saturday → closed');
  assert(!svc.isUsEquityMarketOpen(utc(2026, 4, 19, 15, 0)), 'Sunday → closed');

  // 2026-04-20 Monday in EDT: 9:30 ET = 13:30 UTC; 16:00 ET = 20:00 UTC.
  assert(!svc.isUsEquityMarketOpen(utc(2026, 4, 20, 13, 29)), 'EDT Monday 13:29 UTC (9:29 ET) → closed');
  assert(svc.isUsEquityMarketOpen(utc(2026, 4, 20, 13, 30)), 'EDT Monday 13:30 UTC (9:30 ET) → open');
  assert(svc.isUsEquityMarketOpen(utc(2026, 4, 20, 14, 0)), 'EDT Monday 14:00 UTC (10:00 ET) → open');
  assert(svc.isUsEquityMarketOpen(utc(2026, 4, 20, 19, 59)), 'EDT Monday 19:59 UTC (15:59 ET) → open');
  assert(!svc.isUsEquityMarketOpen(utc(2026, 4, 20, 20, 0)), 'EDT Monday 20:00 UTC (16:00 ET close) → closed');
  assert(!svc.isUsEquityMarketOpen(utc(2026, 4, 20, 21, 0)), 'EDT Monday 21:00 UTC (17:00 ET post-close) → closed');

  // 2026-01-05 Monday in EST: 9:30 ET = 14:30 UTC; 16:00 ET = 21:00 UTC.
  assert(!svc.isUsEquityMarketOpen(utc(2026, 1, 5, 14, 29)), 'EST Monday 14:29 UTC (9:29 ET) → closed');
  assert(svc.isUsEquityMarketOpen(utc(2026, 1, 5, 14, 30)), 'EST Monday 14:30 UTC (9:30 ET) → open');
  assert(svc.isUsEquityMarketOpen(utc(2026, 1, 5, 20, 59)), 'EST Monday 20:59 UTC (15:59 ET) → open');
  assert(!svc.isUsEquityMarketOpen(utc(2026, 1, 5, 21, 0)), 'EST Monday 21:00 UTC (16:00 ET close) → closed');

  // DST transition sanity: 2026-03-09 is the first Monday after DST starts (2026-03-08).
  assert(svc.isUsEquityMarketOpen(utc(2026, 3, 9, 13, 30)), 'First EDT Monday 2026-03-09 13:30 UTC → open');

  // Env override — any weekend/time allowed.
  const prior = process.env.DAY_TRADER_IGNORE_MARKET_HOURS;
  process.env.DAY_TRADER_IGNORE_MARKET_HOURS = 'true';
  try {
    assert(svc.isUsEquityMarketOpen(utc(2026, 4, 18, 3, 0)), 'env override forces true on Saturday 03:00 UTC');
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
