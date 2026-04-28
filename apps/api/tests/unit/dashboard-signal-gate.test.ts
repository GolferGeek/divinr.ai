/**
 * Dashboard signal gate: the dashboard should not surface every completed
 * analysis run as an active signal. Neutral or low-conviction analysis stays
 * on instrument pages.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/markets/markets.service.ts'), 'utf8');

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ ${label}`);
}

console.log('Dashboard signal gate');

assert(
  src.includes('DASHBOARD_SIGNAL_MIN_CONFIDENCE'),
  'dashboard confidence threshold is environment-configurable',
);
assert(
  src.includes("mp.role = 'arbitrator'"),
  'dashboard gate is based on arbitrator synthesis',
);
assert(
  src.includes("mp.predicted_direction in ('up', 'down')"),
  'neutral arbitrator signals are excluded from dashboard cards',
);
assert(
  src.includes('mp.confidence <= 1 then mp.confidence * 100'),
  'dashboard gate handles decimal and percent confidence values',
);

if (process.exitCode) process.exit(1);
