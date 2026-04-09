/**
 * Compliance test: verifies every mutation handler in markets.controller.ts
 * calls requireWriteAccess. Admin-only handlers are exempt (requireAdmin blocks beta_reader).
 * Effort: beta-user-share-path.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

console.log('\n=== Beta Reader Guard Compliance ===\n');

const controllerPath = resolve(__dirname, '../../src/markets/markets.controller.ts');
const source = readFileSync(controllerPath, 'utf-8');

// Find all @Post, @Put, @Patch, @Delete decorated methods
const decoratorPattern = /@(Post|Put|Patch|Delete)\(['"]([^'"]+)['"]\)/g;
const matches: Array<{ method: string; path: string; lineIndex: number }> = [];
const lines = source.split('\n');
for (let i = 0; i < lines.length; i++) {
  const match = decoratorPattern.exec(lines[i]);
  if (match) {
    matches.push({ method: match[1], path: match[2], lineIndex: i });
  }
  decoratorPattern.lastIndex = 0; // Reset regex state
}

console.log(`Found ${matches.length} mutation handlers\n`);

// Admin-only paths that are exempt (requireAdmin already blocks beta_reader)
const adminPaths = new Set([
  'admin/run-settlement',
  'admin/run-nightly-evaluation',
  'admin/run-learning-cycle',
  'admin/run-audit-policy-update',
  'admin/run-tier2-audit',
  'admin/run-crawl',
  'admin/run-predictor-generation',
  'admin/run-prediction-generation',
  'admin/run-outcome-tracking',
  'admin/run-stop-loss-sweep',
  'admin/run-daily-snapshots',
  'admin/run-benchmark-ingest',
  'admin/run-day-trader-strategies',
  'admin/run-eod-forced-buy',
  'admin/run-pipeline',
  'portfolios/admin/monthly-reset',
]);

let nonAdminCount = 0;
let guardedCount = 0;

for (const m of matches) {
  if (adminPaths.has(m.path)) {
    // Admin handler — verify it has requireAdmin instead
    const methodBody = getMethodBody(lines, m.lineIndex);
    assert(
      methodBody.includes('requireAdmin'),
      `[ADMIN] ${m.method} ${m.path} — guarded by requireAdmin`,
    );
    continue;
  }

  nonAdminCount++;
  const methodBody = getMethodBody(lines, m.lineIndex);
  const hasGuard = methodBody.includes('requireWriteAccess');
  assert(hasGuard, `${m.method} ${m.path} — has requireWriteAccess`);
  if (hasGuard) guardedCount++;
}

console.log(`\nNon-admin mutation handlers: ${nonAdminCount}`);
console.log(`Guarded with requireWriteAccess: ${guardedCount}`);

assert(nonAdminCount === guardedCount, `All non-admin mutation handlers are guarded`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

/** Extract ~40 lines after a decorator to check for guard calls. */
function getMethodBody(lines: string[], decoratorLine: number): string {
  return lines.slice(decoratorLine, Math.min(decoratorLine + 40, lines.length)).join('\n');
}
